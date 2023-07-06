import React, { useState, useEffect } from "react";
import { Text, View } from "react-native";

import * as Location from "expo-location";
import { DeviceMotion } from "expo-sensors";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";
import { Rotation, transformOrientation } from "./orientation";

function SolarReadout(props: {
  location: Location.LocationObject | undefined;
  heading: Location.LocationHeadingObject | undefined;
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
    console.log("location change", props.location?.coords);
    if (!props.location) {
      return;
    }
    const { latitude, longitude } = props.location.coords;
    const table = generateSolarTable({ latitude, longitude });
    setSolarTable(table);
  }, [props.location]);

  useEffect(() => {
    const azimuth = props.heading?.trueHeading;
    if (azimuth == undefined || azimuth == -1 || !solarTable) {
      return;
    }
    const entry = Math.floor(azimuth);
    setSolarPosition(solarTable[entry]);
  }, [props.heading]);

  return (
    <View>
      <Text style={styles.paragraph}>{formatTime(solarPosition?.time)}</Text>
      <Text style={styles.paragraph}>↕️ {solarPosition?.elevation}º</Text>
    </View>
  );
}

function Heading(props: {
  heading: Location.LocationHeadingObject | undefined;
}) {
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
  const [heading, setHeading] = useState<Location.LocationHeadingObject>();

  function abbreviate(angle: number | undefined) {
    if (angle == undefined) {
      return "";
    }
    for (let point = 0; point < abbreviations.length; point++) {
      if (angle < (point + 1) * (360 / abbreviations.length)) {
        return abbreviations[point];
      }
    }
  }

  useEffect(() => {
    setHeading(props.heading);
  }, [props.heading]);

  return (
    <View>
      <Text style={styles.paragraph}>{heading?.trueHeading?.toFixed(0)}º</Text>
      <Text style={styles.paragraph}>{abbreviate(heading?.trueHeading)}</Text>
    </View>
  );
}

export default function App() {
  const [location, setLocation] = useState<Location.LocationObject>();
  const [heading, setHeading] = useState<Location.LocationHeadingObject>();
  const [rotation, setRotation] = useState<Rotation>();
  const [pitch, setPitch] = useState(0);

  const [_errorMsg, setErrorMsg] = useState("");

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
      const headingWatcher = await Location.watchHeadingAsync((heading) => {
        setHeading(heading);
      });

      // Start watching the device's rotation
      const motionWatcher = DeviceMotion.addListener((measurement) => {
        const corrected = transformOrientation(measurement.rotation);
        setRotation(corrected);
        const p = true ? corrected.beta - 90 : 90 - corrected.beta;
        setPitch(p);
      });
      return () => {
        headingWatcher.remove();
        motionWatcher.remove();
      };
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Heading heading={heading} />
      <SolarReadout location={location} heading={heading} />
      <Text style={styles.paragraph}>{pitch.toFixed()}º</Text>
      <Text style={{ ...styles.paragraph, fontSize: 24 }}>
        ɑ={rotation?.alpha.toFixed(0)}º β={rotation?.beta.toFixed(0)}º ɣ=
        {rotation?.gamma.toFixed(0)}º
      </Text>
      <Text style={{ ...styles.paragraph, fontSize: 16 }}>
        {location?.coords?.latitude.toFixed(4)}ºN &nbsp;
        {location?.coords?.longitude.toFixed(4)}ºE
      </Text>
    </View>
  );
}
