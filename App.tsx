import React, { useState, useEffect } from "react";
import { Text, View, Dimensions, Image } from "react-native";

import Svg, {
  Circle,
  Line,
  G,
  Text as SvgText,
  SvgUri,
} from "react-native-svg";

import * as Location from "expo-location";
import { DeviceMotion, DeviceMotionMeasurement } from "expo-sensors";
import { Camera, CameraType } from "expo-camera";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";

import { LogBox } from "react-native";

// Some bug in Expo
LogBox.ignoreLogs([
  `Constants.platform.ios.model has been deprecated in favor of expo-device's Device.modelName property. This API will be removed in SDK 45.`,
]);

const halfPI = Math.PI / 2;

type Orientation = {
  heading: number;
  pitch: number;
};

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function padTime(n: number | undefined) {
  if (n == undefined) {
    return "--";
  }
  return n.toString().padStart(2, "0");
}

function formatTime(date: Date | undefined) {
  return padTime(date?.getHours()) + ":" + padTime(date?.getMinutes());
}

function SolarTime(props: { position: SolarPosition; style?: object }) {
  return (
    <Text style={[styles.paragraph, props.style]}>
      {formatTime(props.position?.time)}
    </Text>
  );
}

function SolarElevation(props: { position: SolarPosition; style?: object }) {
  return (
    <Text style={[styles.paragraph, props.style]}>
      ☀️ {props.position?.elevation || "--"}º
    </Text>
  );
}

function CompassPoint(props: { heading: number; style?: object }) {
  const abbreviations = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];

  function abbreviate(angle: number) {
    return abbreviations[Math.floor(angle / (360 / abbreviations.length))];
  }
  return (
    <Text style={[styles.paragraph, props.style]}>
      {abbreviate(props.heading)}
    </Text>
  );
}

function Heading(props: { heading: number; style?: object }) {
  return (
    <Text style={[styles.paragraph, props.style]}>
      {props.heading.toFixed(0)}º
    </Text>
  );
}

function HeadUpDisplay(props: {
  orientation: Orientation;
  solarPosition: SolarPosition;
}) {
  const { height, width } = Dimensions.get("window");

  const degPerPixel = height / 60; // assuming FOV=60º for now
  const sun = {
    x: 0,
    y: (props.orientation.pitch - props.solarPosition.elevation) * degPerPixel,
  };
  const horizon = { y: props.orientation.pitch * degPerPixel };

  const Arrow = require("./assets/arrow.svg");
  return (
    <Svg
      width="100%"
      height="100%"
      fill="none"
      style={[styles.fullScreen, { zIndex: 1 }]}
    >
      <G transform={`translate(${width / 2} ${height / 2})`}>
        <Circle
          cx={sun.x}
          cy={sun.y}
          r={width / 8}
          fill="rgba(255,255,0,0.5)"
        />
        <Line
          x1={-width / 2}
          y1={horizon.y}
          x2={width / 2}
          y2={horizon.y}
          stroke="rgba(255,255,255,0.5)"
          strokeWidth="5"
        />
        <SvgText
          x={sun.x}
          y={sun.y + width / 8 + 32}
          textAnchor="middle"
          stroke={"rgb(255,255,255)"}
          fill={"rgb(255,255,255)"}
          fontSize={32}
          fontFamily="Baskerville"
          fontWeight="bold"
        >
          {formatTime(props.solarPosition.time)}
        </SvgText>
      </G>
      <G
        transform={`translate(${(width * 3) / 8} ${
          height / 2 + height / 8
        }) scale(1,-1)`}
      >
        <SvgUri
          uri={Image.resolveAssetSource(Arrow).uri}
          width={width / 4}
          height={height / 4}
          stroke={"rgba(0,0,0,0.25)"}
          fill={"rgba(255,255,255,0.5)"}
        />
      </G>
    </Svg>
  );
}

export default function App() {
  const [location, setLocation] = useState<Location.LocationObjectCoords>();
  const [orientation, setOrientation] = useState({ heading: 0, pitch: 0 });
  const [solarPosition, setSolarPosition] = useState<SolarPosition>({
    time: new Date(),
    elevation: 0,
  });
  const [_errorMsg, setErrorMsg] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const subscriptions: { remove: () => void }[] = [];

  let motionReading: DeviceMotionMeasurement,
    compassReading: Location.LocationHeadingObject,
    priorOrientation: Orientation | undefined;
  let solarTable: SolarTable;

  const smoothValues = (
    prior: number,
    next: number,
    smoothing: number = 0.5
  ) => {
    return prior * smoothing + next * (1 - smoothing);
  };

  const updateOrientation = () => {
    if (!motionReading || !compassReading || !solarTable) return;

    const { beta, gamma } = motionReading.rotation;
    const azimuth = compassReading.trueHeading;

    // Make pitch be 0º at the horizon and +/- depending on up or down
    // This math requires orientation close to portrait. Would be nice
    // to make it more resilient to roll axis.
    const upwards = Math.abs(gamma) > halfPI;
    const absBeta = Math.abs(beta);
    let pitch = toDegrees(upwards ? halfPI - absBeta : absBeta - halfPI);

    // For whatever reason the magnetometer flips orientation when
    // the device pitches ~roughly~ 45º above the horizon?
    // TODO: Make sure this doesn't flap right around 45º elevation.
    let heading = pitch < 45 ? azimuth : (azimuth + 180) % 360;

    if (priorOrientation) {
      pitch = smoothValues(priorOrientation.pitch, pitch);
      heading = smoothValues(priorOrientation.heading, heading);
    }
    setOrientation({ pitch, heading });
    priorOrientation = { pitch, heading };

    const tableEntry = Math.floor(heading);
    setSolarPosition(solarTable[tableEntry]);
  };

  useEffect(() => {
    (async () => {
      const locationPerms = await Location.requestForegroundPermissionsAsync();
      if (locationPerms.status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        console.log("Location permission denied");
        return;
      }

      const cameraPerms = await Camera.requestCameraPermissionsAsync();
      if (cameraPerms.status === "granted") {
        setCameraReady(true);
      } else {
        setErrorMsg("Permission to access camera was denied");
        console.log("Camera permission denied");
      }

      // Get position fix (we only need it once)
      const lastKnownLocation = await Location.getLastKnownPositionAsync();
      if (!lastKnownLocation) {
        setErrorMsg("Can't determine last known location");
        return;
      }
      setLocation(lastKnownLocation.coords);
      if (!solarTable) {
        solarTable = generateSolarTable(lastKnownLocation.coords);
      }

      // Start watching the device's compass heading
      subscriptions.push(
        await Location.watchHeadingAsync((reading) => {
          compassReading = reading;
          updateOrientation();
        })
      );
    })();
    subscriptions.push(
      DeviceMotion.addListener((reading) => {
        motionReading = reading;
        updateOrientation();
      })
    );
    return () => {
      subscriptions.forEach((sub) => {
        sub.remove();
      });
    };
  }, []);

  return (
    <View style={styles.container}>
      {cameraReady ? (
        <Camera
          type={CameraType.back}
          style={[styles.fullScreen, { zIndex: 0 }]}
        />
      ) : (
        ""
      )}
      <HeadUpDisplay orientation={orientation} solarPosition={solarPosition} />
      <View style={[styles.container, { flex: 7 }]} />
      <View
        style={[
          styles.container,
          styles.widget,
          {
            flexDirection: "row",
            flexGrow: 1,
            alignItems: "stretch",
          },
        ]}
      >
        <View style={styles.container}>
          <CompassPoint
            heading={orientation.heading}
            style={{ fontSize: 32, fontFamily: "Baskerville" }}
          />
          {/*
          <SolarTime position={solarPosition} style={{ fontSize: 32 }} />
          <SolarElevation position={solarPosition} style={{ fontSize: 16 }} />
          */}
        </View>
        {/*}
        <View style={styles.container}>
          <Text style={styles.paragraph}>
            ↕️ {orientation.pitch.toFixed()}º
          </Text>
        </View>*/}
      </View>
      {/*
      <View style={[styles.container, styles.widget, { alignSelf: "stretch" }]}>
        <Text style={{ ...styles.paragraph, fontSize: 16 }}>
          {location?.latitude.toFixed(4)}ºN &nbsp;
          {location?.longitude.toFixed(4)}ºE
        </Text>
      </View>
      */}
    </View>
  );
}
