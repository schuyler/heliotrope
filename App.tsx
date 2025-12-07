import React, { useState, useEffect, useRef } from "react";
import { Text, View, Dimensions, Image } from "react-native";

import Svg, {
  Circle,
  Line,
  G,
  Text as SvgText,
  SvgUri,
} from "react-native-svg";

import * as Location from "expo-location";
import { Gyroscope, Accelerometer, Magnetometer } from "expo-sensors";
import { CameraView, useCameraPermissions } from "expo-camera";
import Madgwick from "ahrs";
// @ts-ignore - no types available for geomagnetism
import geomagnetism from "geomagnetism";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";
import {
  smoothOrientation,
  applyDeclination,
  Orientation as AHRSOrientation,
  SensorReading,
  hasAllSensorReadings,
} from "./ahrs-orientation";

import { LogBox } from "react-native";

// Some bug in Expo
LogBox.ignoreLogs([
  `Constants.platform.ios.model has been deprecated in favor of expo-device's Device.modelName property. This API will be removed in SDK 45.`,
]);

// Re-export the Orientation type for use in components
type Orientation = AHRSOrientation;

// AHRS configuration
const AHRS_SAMPLE_INTERVAL = 20; // 50Hz update rate
const AHRS_BETA = 0.1; // Madgwick filter gain (tune between 0.05-0.15)

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
  const iconSize = width / 8;
  const textSize = 32;

  const degPerPixel = height / 60; // assuming FOV=60º for now
  const relativeElevation =
    props.orientation.pitch - props.solarPosition.elevation;
  const sun = {
    x: 0,
    y: relativeElevation * degPerPixel,
  };
  const horizon = { y: props.orientation.pitch * degPerPixel };

  const isSunVisible =
    sun.y > height / 2 + iconSize || sun.y + iconSize + textSize < -height / 2;
  const arrowTransform =
    sun.y < 0
      ? `translate(${
          width / 2 - iconSize
        } ${iconSize}) rotate(180 ${iconSize} ${iconSize})`
      : `translate(${width / 2 - iconSize} ${(height * 3) / 4 - iconSize})`;

  const Arrow = require("./assets/arrow.svg");
  return (
    <Svg
      width="100%"
      height="100%"
      fill="none"
      style={[styles.fullScreen, { zIndex: 1 }]}
    >
      <G transform={`translate(${width / 2} ${height / 2})`}>
        <Circle cx={sun.x} cy={sun.y} r={iconSize} fill="rgba(255,255,0,0.5)" />
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
          y={sun.y + iconSize + textSize}
          textAnchor="middle"
          stroke={"rgb(255,255,255)"}
          fill={"rgb(255,255,255)"}
          fontSize={textSize}
          fontFamily="Baskerville"
          fontWeight="bold"
        >
          {formatTime(props.solarPosition.time)}
        </SvgText>
      </G>
      {isSunVisible ? (
        <G transform={arrowTransform}>
          <SvgUri
            uri={Image.resolveAssetSource(Arrow).uri}
            width={width / 4}
            height={width / 4}
            stroke={"rgba(0,0,0,0.5)"}
            fill={"rgba(255,255,255,0.25)"}
          />
        </G>
      ) : (
        ""
      )}
    </Svg>
  );
}

export default function App() {
  const [location, setLocation] = useState<Location.LocationObjectCoords>();
  const [orientation, setOrientation] = useState<Orientation>({ heading: 0, pitch: 0, roll: 0 });
  const [solarPosition, setSolarPosition] = useState<SolarPosition>({
    time: new Date(),
    elevation: 0,
  });
  const [_errorMsg, setErrorMsg] = useState("");
  const [cameraPermission, requestCameraPermissions] = useCameraPermissions();

  // Refs for mutable values that persist across renders
  const subscriptionsRef = useRef<{ remove: () => void }[]>([]);
  const solarTableRef = useRef<SolarTable | null>(null);
  const declinationRef = useRef<number>(0);
  const priorOrientationRef = useRef<Orientation | null>(null);

  // Sensor data refs (updated by sensor callbacks)
  const gyroDataRef = useRef<SensorReading | null>(null);
  const accelDataRef = useRef<SensorReading | null>(null);
  const magDataRef = useRef<SensorReading | null>(null);

  // AHRS filter ref
  const madgwickRef = useRef<Madgwick | null>(null);

  // Initialize Madgwick filter on first render
  if (!madgwickRef.current) {
    madgwickRef.current = new Madgwick({
      sampleInterval: AHRS_SAMPLE_INTERVAL,
      beta: AHRS_BETA,
    });
  }

  /**
   * Updates orientation using AHRS sensor fusion.
   * Called whenever any sensor provides new data.
   */
  const updateOrientationAHRS = () => {
    const gyro = gyroDataRef.current;
    const accel = accelDataRef.current;
    const mag = magDataRef.current;
    const solarTable = solarTableRef.current;
    const madgwick = madgwickRef.current;

    // Wait until we have all three sensor readings and solar table
    if (!hasAllSensorReadings(gyro, accel, mag) || !solarTable || !madgwick) {
      return;
    }

    // Update Madgwick filter with sensor data
    // Gyroscope: rad/s, Accelerometer: g, Magnetometer: µT
    madgwick.update(
      gyro!.x, gyro!.y, gyro!.z,
      accel!.x, accel!.y, accel!.z,
      mag!.x, mag!.y, mag!.z
    );

    // Get Euler angles from AHRS
    const euler = madgwick.getEulerAngles();

    // Convert to degrees and apply coordinate system adjustments
    // Note: May need to adjust signs/offsets based on device testing
    let heading = euler.heading * (180 / Math.PI);
    let pitch = euler.pitch * (180 / Math.PI);
    let roll = euler.roll * (180 / Math.PI);

    // Apply magnetic declination for true heading
    heading = applyDeclination(heading, declinationRef.current);

    // Create new orientation
    let newOrientation: Orientation = { heading, pitch, roll };

    // Apply smoothing if we have a prior orientation
    if (priorOrientationRef.current) {
      newOrientation = smoothOrientation(priorOrientationRef.current, newOrientation, 0.2);
    }

    priorOrientationRef.current = newOrientation;
    setOrientation(newOrientation);
    setSolarPosition(solarTable[Math.floor(newOrientation.heading)]);
  };

  useEffect(() => {
    (async () => {
      requestCameraPermissions();

      const locationPerms = await Location.requestForegroundPermissionsAsync();
      if (locationPerms.status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        console.log("Location permission denied");
        return;
      }

      // Get position fix (we only need it once)
      const lastKnownLocation = await Location.getLastKnownPositionAsync();
      if (!lastKnownLocation) {
        setErrorMsg("Can't determine last known location");
        return;
      }
      setLocation(lastKnownLocation.coords);

      // Generate solar table
      if (!solarTableRef.current) {
        solarTableRef.current = generateSolarTable(lastKnownLocation.coords);
      }

      // Calculate magnetic declination for true north correction
      try {
        const geoMag = geomagnetism.model().point([
          lastKnownLocation.coords.latitude,
          lastKnownLocation.coords.longitude,
        ]);
        declinationRef.current = geoMag.decl; // Degrees
      } catch (e) {
        console.warn("Failed to calculate magnetic declination:", e);
        declinationRef.current = 0;
      }

      // Request sensor permissions
      const [gyroPerms, accelPerms, magPerms] = await Promise.all([
        Gyroscope.requestPermissionsAsync(),
        Accelerometer.requestPermissionsAsync(),
        Magnetometer.requestPermissionsAsync(),
      ]);

      if (gyroPerms.status !== "granted" ||
          accelPerms.status !== "granted" ||
          magPerms.status !== "granted") {
        setErrorMsg("Permission to access motion sensors was denied");
        console.log("Sensor permissions denied");
        return;
      }

      // Set update intervals for all sensors (50Hz = 20ms)
      Gyroscope.setUpdateInterval(AHRS_SAMPLE_INTERVAL);
      Accelerometer.setUpdateInterval(AHRS_SAMPLE_INTERVAL);
      Magnetometer.setUpdateInterval(AHRS_SAMPLE_INTERVAL);

      // Subscribe to gyroscope
      subscriptionsRef.current.push(
        Gyroscope.addListener((data) => {
          gyroDataRef.current = data;
          updateOrientationAHRS();
        })
      );

      // Subscribe to accelerometer
      subscriptionsRef.current.push(
        Accelerometer.addListener((data) => {
          accelDataRef.current = data;
          updateOrientationAHRS();
        })
      );

      // Subscribe to magnetometer
      subscriptionsRef.current.push(
        Magnetometer.addListener((data) => {
          magDataRef.current = data;
          updateOrientationAHRS();
        })
      );
    })();

    return () => {
      subscriptionsRef.current.forEach((sub) => {
        sub.remove();
      });
      subscriptionsRef.current = [];
    };
  }, []);

  return (
    <View style={styles.container}>
      {cameraPermission?.granted ? (
        <CameraView
          facing="back"
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
      {/*
        <View style={styles.container}>
          <Text style={{...styles.paragraph, fontSize: 16}}>
            ↕️ {orientation.pitch.toFixed()}º
          </Text>
        </View>
      */}
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
