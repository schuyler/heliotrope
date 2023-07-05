import { SunSector } from "sun-sector";

export type SolarPosition = {
  time: Date;
  elevation: number;
};

export type SolarTable = Array<SolarPosition>;

export function generateSolarTable({
  latitude,
  longitude,
}: {
  latitude: number;
  longitude: number;
}): SolarTable {
  const table = Array(360).fill(null) as SolarTable;
  const start = Date.now();

  const sector = SunSector.from(latitude, longitude);
  for (let minutes = 0; minutes < 24 * 60; minutes += 1) {
    const when = new Date(start + minutes * 60e3);
    const sun = sector.at(when);
    const azimuth = Math.floor(sun.azimuth);
    table[azimuth] = { time: when, elevation: Math.round(sun.elevation) };
  }

  return table;
}
