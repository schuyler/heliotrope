import React, { useState, useEffect, useRef } from "react";
import { Text, View } from "react-native";

import * as Location from "expo-location";
import { DeviceMotion } from "expo-sensors";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";

const halfPI = Math.PI / 2;

function rotationToPitch(rotation: { beta: number; gamma: number }) {
  const upwards = Math.abs(rotation.gamma) > halfPI;
  const absBeta = Math.abs(rotation.beta);
  return upwards ? halfPI - absBeta : absBeta - halfPI;
}

function adjustHeadingForPitch(heading: number, pitch: number) {
  const adjusted = pitch < Math.PI / 4 ? heading : (heading + 180) % 360;
  console.log("heading", heading, pitch.toFixed(3), adjusted);
  return adjusted;
}

function toDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

function SolarReadout(props: {
  location: Location.LocationObject | undefined;
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
    const { latitude, longitude } = props.location.coords;
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
    <View>
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
    <View>
      <Text style={styles.paragraph}>{props.heading.toFixed(0)}º</Text>
      <Text style={styles.paragraph}>{abbreviate(props.heading)}</Text>
    </View>
  );
}

export default function App() {
  const [location, setLocation] = useState<Location.LocationObject>();
  const [heading, setHeading] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [_errorMsg, setErrorMsg] = useState("");

  const pitchRef = useRef(pitch);

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        return;
      }

      // Get position fix (we only need it once)
      const lastKnownLocation = await Location.getLastKnownPositionAsync();
      setLocation(lastKnownLocation || undefined);

      // Start watching the device's compass heading
      const subscriptions = [
        await Location.watchHeadingAsync((heading) => {
          setHeading(
            adjustHeadingForPitch(heading.trueHeading, pitchRef.current)
          );
        }),
        DeviceMotion.addListener((measurement) => {
          setPitch(rotationToPitch(measurement.rotation));
        }),
      ];
      return () => {
        subscriptions.forEach((sub) => {
          sub.remove();
        });
      };
    })();
  }, []);

  useEffect(() => {
    // Ensure the ref is always at the latest value
    pitchRef.current = pitch;
  }, [pitch]);

  return (
    <View style={styles.container}>
      <Heading heading={heading} />
      <SolarReadout location={location} heading={heading} />
      <Text style={styles.paragraph}>↕️ {toDegrees(pitch).toFixed()}º</Text>
      <Text style={{ ...styles.paragraph, fontSize: 16 }}>
        {location?.coords?.latitude.toFixed(4)}ºN &nbsp;
        {location?.coords?.longitude.toFixed(4)}ºE
      </Text>
    </View>
  );
}
