import React, { useState, useEffect } from "react";
import { Text, View } from "react-native";

import * as Location from "expo-location";

import { styles } from "./style";
import { generateSolarTable, SolarTable, SolarPosition } from "./solar";

export default function App() {
  const [position, setPosition] = useState<Location.LocationObject | null>();
  const [heading, setHeading] =
    useState<Location.LocationHeadingObject | null>();
  const [_errorMsg, setErrorMsg] = useState("");
  const [solarTable, setSolarTable] = useState<SolarTable | null>();
  const [solarPosition, setSolarPosition] = useState<SolarPosition | null>();

  const headingAccuracy = ["none", "low", "med", "high"];

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setErrorMsg("Permission to access location was denied");
        return;
      }

      // Get position fix (we only need it once)
      const lastKnownPosition = await Location.getLastKnownPositionAsync();
      setPosition(lastKnownPosition);

      if (lastKnownPosition != null) {
        setErrorMsg("Can't determine location");
        //console.log("lastKnownPosition", lastKnownPosition);
        if (solarTable == null) {
          const table = generateSolarTable(lastKnownPosition.coords);
          setSolarTable(table);
          //console.log("solarTable", solarTable && solarTable[0]);
        }
      }

      // Start watching the device's compass heading
      Location.watchHeadingAsync((heading) => {
        setHeading(heading);
        if (heading.trueHeading != null && heading.trueHeading != -1) {
          const azimuth = Math.floor(heading.magHeading);
          if (solarTable && solarTable[azimuth]) {
            setSolarPosition(solarTable[azimuth]);
          }
        }
      });
    })();
  }, [solarTable]);

  function padTime(n: number | undefined) {
    if (n == undefined) {
      return "--";
    }
    return n.toString().padStart(2, "0");
  }

  function formatTime(date: Date | undefined) {
    return padTime(date?.getHours()) + ":" + padTime(date?.getMinutes());
    /*
    if (date != undefined) {
      return date.toLocaleTimeString() +
        "(" +
        (date.getTimezoneOffset() / 60).toFixed() +
        ")";
    }
    */
  }

  return (
    <View style={styles.container}>
      <Text style={styles.paragraph}>
        {position?.coords?.latitude.toFixed(4)}ºN &nbsp;
        {position?.coords?.longitude.toFixed(4)}ºE
      </Text>
      <Text style={styles.paragraph}>
        {heading?.trueHeading?.toFixed(0)}º (
        {headingAccuracy[heading?.accuracy || 0]})
      </Text>
      <Text style={styles.paragraph}>{formatTime(solarPosition?.time)}</Text>
      <Text style={styles.paragraph}>↕️ {solarPosition?.elevation}º</Text>
    </View>
  );
}
