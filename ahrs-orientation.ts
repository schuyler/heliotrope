/**
 * AHRS Orientation utilities for Heliotrope
 *
 * This module contains pure functions for orientation calculation
 * that can be unit tested independently of React Native sensors.
 */

export type Orientation = {
  heading: number;
  pitch: number;
  roll: number;
};

export type SensorReading = {
  x: number;
  y: number;
  z: number;
};

export type EulerAngles = {
  heading: number;
  pitch: number;
  roll: number;
};

/**
 * Smooths a value transition, handling wraparound for angular values.
 * Uses exponential smoothing: result = prior * smoothing + next * (1 - smoothing)
 *
 * @param prior - Previous value
 * @param next - New value
 * @param smoothing - Smoothing factor (0-1). Higher = more smoothing/lag
 * @returns Smoothed value
 */
export function smoothValue(
  prior: number,
  next: number,
  smoothing: number = 0.2
): number {
  // Handle wraparound for angular values (e.g., 359° -> 1°)
  if (next > prior + 180) next -= 360;
  if (next < prior - 180) next += 360;
  return prior * smoothing + next * (1 - smoothing);
}

/**
 * Normalizes a heading to the range [0, 360)
 *
 * @param heading - Raw heading value (may be negative or > 360)
 * @returns Heading in range [0, 360)
 */
export function normalizeHeading(heading: number): number {
  // Handle negative values and wraparound
  heading = heading % 360;
  if (heading < 0) {
    heading += 360;
  }
  // Handle JavaScript's -0 edge case
  return heading === 0 ? 0 : heading;
}

/**
 * Applies magnetic declination to convert magnetic heading to true heading.
 *
 * @param magneticHeading - Heading relative to magnetic north
 * @param declination - Local magnetic declination (positive = east)
 * @returns True heading relative to geographic north
 */
export function applyDeclination(
  magneticHeading: number,
  declination: number
): number {
  return normalizeHeading(magneticHeading + declination);
}

/**
 * Converts AHRS Euler angles to our orientation format.
 * May need coordinate system adjustments based on device/library.
 *
 * @param euler - Euler angles from AHRS filter
 * @param headingOffset - Offset to apply to heading (default 0, use 180 if heading is backwards)
 * @param invertPitch - Whether to invert pitch (default false)
 * @returns Orientation in our coordinate system
 */
export function convertEulerToOrientation(
  euler: EulerAngles,
  headingOffset: number = 0,
  invertPitch: boolean = false
): Orientation {
  const pitch = invertPitch ? -euler.pitch : euler.pitch;
  return {
    heading: normalizeHeading(euler.heading + headingOffset),
    pitch: clampPitch(pitch),
    roll: euler.roll,
  };
}

/**
 * Smooths an entire orientation, handling heading wraparound.
 * Heading is normalized to [0, 360) and pitch is clamped to [-90, 90].
 *
 * @param prior - Previous orientation
 * @param next - New orientation
 * @param smoothing - Smoothing factor (0-1)
 * @returns Smoothed orientation with normalized heading and clamped pitch
 */
export function smoothOrientation(
  prior: Orientation,
  next: Orientation,
  smoothing: number = 0.2
): Orientation {
  return {
    heading: normalizeHeading(smoothValue(prior.heading, next.heading, smoothing)),
    pitch: clampPitch(smoothValue(prior.pitch, next.pitch, smoothing)),
    roll: smoothValue(prior.roll, next.roll, smoothing),
  };
}

/**
 * Checks if all sensor readings are available.
 * AHRS needs all three sensors to compute orientation.
 *
 * @param gyro - Gyroscope reading
 * @param accel - Accelerometer reading
 * @param mag - Magnetometer reading
 * @returns true if all sensors have valid readings
 */
export function hasAllSensorReadings(
  gyro: SensorReading | null,
  accel: SensorReading | null,
  mag: SensorReading | null
): boolean {
  return gyro !== null && accel !== null && mag !== null;
}

/**
 * Validates that a sensor reading has finite values.
 * Guards against NaN or Infinity from sensor errors.
 *
 * @param reading - Sensor reading to validate
 * @returns true if all values are finite numbers
 */
export function isValidSensorReading(reading: SensorReading | null): boolean {
  if (reading === null) return false;
  return (
    Number.isFinite(reading.x) &&
    Number.isFinite(reading.y) &&
    Number.isFinite(reading.z)
  );
}

/**
 * Clamps pitch to valid range [-90, 90] degrees.
 *
 * @param pitch - Raw pitch value
 * @returns Clamped pitch
 */
export function clampPitch(pitch: number): number {
  return Math.max(-90, Math.min(90, pitch));
}

/**
 * Calculates the angular difference between two headings,
 * accounting for wraparound (result is always in [-180, 180]).
 *
 * @param heading1 - First heading
 * @param heading2 - Second heading
 * @returns Shortest angular distance
 */
export function headingDifference(heading1: number, heading2: number): number {
  let diff = heading2 - heading1;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  return diff;
}
