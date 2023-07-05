import React, { useState, useEffect } from "react";
import { Text, View } from "react-native";

import * as Location from "expo-location";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";

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

export default function App() {
  const [location, setLocation] = useState<Location.LocationObject>();
  const [heading, setHeading] = useState<Location.LocationHeadingObject>();
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
      Location.watchHeadingAsync((heading) => {
        setHeading(heading);
      });
    })();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.paragraph}>
        {location?.coords?.latitude.toFixed(4)}ºN &nbsp;
        {location?.coords?.longitude.toFixed(4)}ºE
      </Text>
      <Text style={styles.paragraph}>{heading?.trueHeading?.toFixed(0)}º</Text>
      <SolarReadout location={location} heading={heading} />
    </View>
  );
}
