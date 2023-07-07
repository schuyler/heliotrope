import React, { useState, useEffect, useRef } from "react";
import { Text, View, Dimensions } from "react-native";

import Canvas from "react-native-canvas";

import * as Location from "expo-location";
import { DeviceMotion, DeviceMotionMeasurement } from "expo-sensors";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";

const halfPI = Math.PI / 2;

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function SolarReadout(props: {
  location: Location.LocationObjectCoords | undefined;
  heading: number;
}) {
  const [solarTable, setSolarTable] = useState<SolarTable>();
  const [solarPosition, setSolarPosition] = useState<SolarPosition>();

  function padTime(n: number | undefined) {
    if (n == undefined) {
      return "--";
    }
    return n.toString().padStart(2, "0");
  }

  function formatTime(date: Date | undefined) {
    return padTime(date?.getHours()) + ":" + padTime(date?.getMinutes());
  }

  useEffect(() => {
    if (!props.location) {
      return;
    }
    const { latitude, longitude } = props.location;
    const table = generateSolarTable({ latitude, longitude });
    setSolarTable(table);
  }, [props.location]);

  useEffect(() => {
    const azimuth = props.heading;
    if (azimuth == -1 || !solarTable) {
      return;
    }
    const entry = Math.floor(azimuth);
    setSolarPosition(solarTable[entry]);
  }, [props.heading]);

  return (
    <View style={styles.container}>
      <Text style={styles.paragraph}>{formatTime(solarPosition?.time)}</Text>
      <Text style={styles.paragraph}>☀️ {solarPosition?.elevation}º</Text>
    </View>
  );
}

function Heading(props: { heading: number }) {
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
    <View style={styles.container}>
      <Text style={styles.paragraph}>{abbreviate(props.heading)}</Text>
      <Text style={styles.paragraph}>{props.heading.toFixed(0)}º</Text>
    </View>
  );
}

export default function App() {
  const [location, setLocation] = useState<Location.LocationObjectCoords>();
  const [orientation, setOrientation] = useState({ heading: 0, pitch: 0 });
  const [_errorMsg, setErrorMsg] = useState("");

  let motionReading: DeviceMotionMeasurement,
    compassReading: Location.LocationHeadingObject,
    previousHeading: number = -1;
  const subscriptions: { remove: () => void }[] = [];

  const updateOrientation = () => {
    if (!motionReading || !compassReading) return;

    const { beta, gamma } = motionReading.rotation;
    const azimuth = compassReading.trueHeading;

    // Make pitch be 0º at the horizon and +/- depending on up or down
    // This math requires orientation close to portrait. Would be nice
    // to make it more resilient to roll axis.
    const upwards = Math.abs(gamma) > halfPI;
    const absBeta = Math.abs(beta);
    const pitch = toDegrees(upwards ? halfPI - absBeta : absBeta - halfPI);

    // For whatever reason the magnetometer flips orientation when
    // the device pitches ~roughly~ 45º above the horizon?
    // TODO: Make sure this doesn't flap right around 45º elevation.
    let heading = pitch < 45 ? azimuth : (azimuth + 180) % 360;
    previousHeading = heading;

    setOrientation({ pitch, heading });
  };

  const canvasRef = useRef<Canvas | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const window = Dimensions.get("window");
    canvas.height = window.height;
    canvas.width = window.width;

    ctx.fillStyle = "rgba(255, 255, 0, 1)";
    ctx.beginPath();
    ctx.arc(
      canvas.width / 2,
      canvas.height / 2,
      canvas.width / 8,
      0,
      2 * Math.PI
    );
    ctx.fill();

    return () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [canvasRef]);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        return;
      }

      // Get position fix (we only need it once)
      const lastKnownLocation = await Location.getLastKnownPositionAsync();
      setLocation(lastKnownLocation?.coords || undefined);

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
      <Canvas
        ref={canvasRef}
        style={{
          flex: 6,
          width: "100%",
          height: "100%",
          backgroundColor: "#000",
        }}
      />
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
        <Heading heading={orientation.heading} />
        <SolarReadout location={location} heading={orientation.heading} />
        <View style={styles.container}>
          <Text style={styles.paragraph}>
            ↕️ {orientation.pitch.toFixed()}º
          </Text>
        </View>
      </View>
      <View style={[styles.container, styles.widget, { alignSelf: "stretch" }]}>
        <Text style={{ ...styles.paragraph, fontSize: 16 }}>
          {location?.latitude.toFixed(4)}ºN &nbsp;
          {location?.longitude.toFixed(4)}ºE
        </Text>
      </View>
    </View>
  );
}
