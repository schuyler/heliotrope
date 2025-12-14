import React, { useState, useEffect, useRef } from "react";
import { Text, View, Dimensions, Image, Animated, StyleSheet } from "react-native";
import {
  GestureHandlerRootView,
  Gesture,
  GestureDetector,
} from "react-native-gesture-handler";
import { runOnJS } from "react-native-reanimated";

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

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";
import {
  smoothOrientation,
  applyDeclination,
  Orientation as AHRSOrientation,
  SensorReading,
  hasAllSensorReadings,
  isValidSensorReading,
} from "./ahrs-orientation";
import { BetaSettingsModal } from "./BetaSettingsModal";
import { loadBeta, saveBeta, DEFAULT_BETA } from "./beta-storage";

import { LogBox } from "react-native";

// Some bug in Expo
LogBox.ignoreLogs([
  `Constants.platform.ios.model has been deprecated in favor of expo-device's Device.modelName property. This API will be removed in SDK 45.`,
]);

// Re-export the Orientation type for use in components
type Orientation = AHRSOrientation;

// AHRS configuration
const AHRS_SAMPLE_INTERVAL = 20; // 50Hz update rate

// Compass calibration configuration
const CALIBRATION_INTERVAL_MS = 30000; // Recalibrate every 30 seconds
const CALIBRATION_PITCH_THRESHOLD = 15; // Only calibrate when |pitch| < 15°

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
  const priorOrientationRef = useRef<Orientation | null>(null);

  // Sensor data refs (updated by sensor callbacks)
  const gyroDataRef = useRef<SensorReading | null>(null);
  const accelDataRef = useRef<SensorReading | null>(null);
  const magDataRef = useRef<SensorReading | null>(null);

  // AHRS filter ref
  const madgwickRef = useRef<Madgwick | null>(null);

  // AHRS failure detection
  const ahrsFailureCountRef = useRef<number>(0);
  const MAX_AHRS_FAILURES = 10;

  // Beta parameter state and modal
  const [ahrsBeta, setAhrsBeta] = useState<number>(DEFAULT_BETA);
  const [betaModalVisible, setBetaModalVisible] = useState<boolean>(false);
  const ahrsBetaRef = useRef<number>(DEFAULT_BETA);

  // Compass calibration (heading offset from iOS compass)
  const headingOffsetRef = useRef<number>(0);
  const lastCalibrationTimeRef = useRef<number>(0);
  const calibrationInProgressRef = useRef<boolean>(false);

  // Calibration overlay state and animations
  const [isCalibrated, setIsCalibrated] = useState<boolean>(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const fadeAnim = useRef(new Animated.Value(1)).current;

  // Initialize Madgwick filter on first render
  if (!madgwickRef.current) {
    madgwickRef.current = new Madgwick({
      sampleInterval: AHRS_SAMPLE_INTERVAL,
      beta: ahrsBetaRef.current,
    });
  }

  // Start pulse animation on mount, fade out when calibrated
  useEffect(() => {
    // Pulse animation loop
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.6,
          duration: 1000,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        }),
      ])
    );
    pulse.start();

    return () => pulse.stop();
  }, []);

  // Fade out overlay when calibrated
  useEffect(() => {
    if (isCalibrated) {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 500,
        useNativeDriver: true,
      }).start();
    }
  }, [isCalibrated]);

  /**
   * Performs compass calibration by comparing AHRS heading to iOS compass.
   * Called on first reading (regardless of pitch) and periodically when level.
   * @param ahrsHeading - Current AHRS heading in degrees
   * @param pitch - Current pitch in degrees (used for 180° flip correction)
   */
  const performCalibration = async (ahrsHeading: number, pitch: number) => {
    if (calibrationInProgressRef.current) return;
    calibrationInProgressRef.current = true;

    try {
      const iosHeading = await Location.getHeadingAsync();
      if (iosHeading && Number.isFinite(iosHeading.trueHeading)) {
        let correctedIosHeading = iosHeading.trueHeading;

        // iOS compass flips 180° at high pitch angles (the gimbal lock problem).
        // If we're calibrating at high pitch, compensate for this known failure.
        if (Math.abs(pitch) > 45) {
          correctedIosHeading = (correctedIosHeading + 180) % 360;
        }

        // Calculate offset: what we need to add to AHRS to match iOS
        let offset = correctedIosHeading - ahrsHeading;
        // Normalize to [-180, 180]
        while (offset > 180) offset -= 360;
        while (offset < -180) offset += 360;

        headingOffsetRef.current = offset;
        lastCalibrationTimeRef.current = Date.now();

        // Mark as calibrated on first successful calibration (triggers fade out)
        if (!isCalibrated) {
          setIsCalibrated(true);
        }
      }
    } catch (e) {
      console.warn("Compass calibration failed:", e);
    } finally {
      calibrationInProgressRef.current = false;
    }
  };

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

    // Wait until we have all three sensor readings and filter is ready
    if (!hasAllSensorReadings(gyro, accel, mag) || !madgwick) {
      return;
    }

    // Validate sensor data to prevent NaN/Infinity from corrupting AHRS
    if (!isValidSensorReading(gyro) ||
        !isValidSensorReading(accel) ||
        !isValidSensorReading(mag)) {
      console.warn("Invalid sensor reading detected, skipping AHRS update");
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

    // Validate Euler angles - filter can produce NaN if corrupted
    if (!Number.isFinite(euler.heading) ||
        !Number.isFinite(euler.pitch) ||
        !Number.isFinite(euler.roll)) {
      ahrsFailureCountRef.current++;
      console.error("AHRS produced invalid angles:", euler,
        `(failure ${ahrsFailureCountRef.current}/${MAX_AHRS_FAILURES})`);

      // If too many failures, reset the filter
      if (ahrsFailureCountRef.current >= MAX_AHRS_FAILURES) {
        console.error("AHRS filter appears stuck, resetting...");
        madgwickRef.current = new Madgwick({
          sampleInterval: AHRS_SAMPLE_INTERVAL,
          beta: ahrsBetaRef.current,
        });
        ahrsFailureCountRef.current = 0;
      }
      return;
    }

    // Reset failure counter on successful update
    ahrsFailureCountRef.current = 0;

    // Convert to degrees
    // COORDINATE SYSTEM NOTE: The AHRS library expects X=North, Y=East, Z=Down.
    // Expo sensors may use different conventions. If heading is 180° off or
    // pitch is inverted, adjust the signs/offsets here after device testing.
    let heading = euler.heading * (180 / Math.PI);
    let pitch = euler.pitch * (180 / Math.PI);
    let roll = euler.roll * (180 / Math.PI);

    // Calibration logic:
    // - First reading: always calibrate (bootstrap), with 180° flip correction if tilted
    // - Subsequent: only calibrate when level and interval has elapsed
    const now = Date.now();
    const isFirstReading = lastCalibrationTimeRef.current === 0;
    const timeSinceCalibration = now - lastCalibrationTimeRef.current;
    const isLevel = Math.abs(pitch) < CALIBRATION_PITCH_THRESHOLD;
    const intervalElapsed = timeSinceCalibration >= CALIBRATION_INTERVAL_MS;

    if (isFirstReading || (isLevel && intervalElapsed)) {
      performCalibration(heading, pitch);
    }

    // Apply heading offset from compass calibration
    heading = applyDeclination(heading, headingOffsetRef.current);

    // Create new orientation
    let newOrientation: Orientation = { heading, pitch, roll };

    // Apply smoothing if we have a prior orientation
    if (priorOrientationRef.current) {
      newOrientation = smoothOrientation(priorOrientationRef.current, newOrientation, 0.2);
    }

    priorOrientationRef.current = newOrientation;
    setOrientation(newOrientation);

    // Update solar position if solar table is available (optional)
    if (solarTable) {
      const headingIndex = Math.floor(newOrientation.heading) % 360;
      setSolarPosition(solarTable[headingIndex]);
    }
  };

  // Load beta value from storage on mount
  useEffect(() => {
    (async () => {
      const storedBeta = await loadBeta();
      setAhrsBeta(storedBeta);
      ahrsBetaRef.current = storedBeta;

      // Reinitialize filter with loaded beta if different from default
      if (storedBeta !== DEFAULT_BETA) {
        madgwickRef.current = new Madgwick({
          sampleInterval: AHRS_SAMPLE_INTERVAL,
          beta: storedBeta,
        });
      }
    })();
  }, []);

  // Handle beta parameter changes
  const handleBetaChange = async (newBeta: number) => {
    setAhrsBeta(newBeta);
    ahrsBetaRef.current = newBeta;

    // Persist to storage
    await saveBeta(newBeta);

    // Reinitialize the Madgwick filter with new beta
    madgwickRef.current = new Madgwick({
      sampleInterval: AHRS_SAMPLE_INTERVAL,
      beta: newBeta,
    });

    // Reset failure counter since we have a fresh filter
    ahrsFailureCountRef.current = 0;
  };

  // Double-tap gesture to open beta settings
  const openBetaModal = () => setBetaModalVisible(true);
  const doubleTapGesture = Gesture.Tap()
    .numberOfTaps(2)
    .maxDuration(300)
    .onEnd(() => {
      runOnJS(openBetaModal)();
    });

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
    <GestureHandlerRootView style={{ flex: 1 }}>
      <GestureDetector gesture={doubleTapGesture}>
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

          <BetaSettingsModal
            visible={betaModalVisible}
            currentBeta={ahrsBeta}
            onClose={() => setBetaModalVisible(false)}
            onBetaChange={handleBetaChange}
          />
        </View>
      </GestureDetector>
    </GestureHandlerRootView>
  );
}
