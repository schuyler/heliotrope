import {
  smoothValue,
  normalizeHeading,
  applyDeclination,
  convertEulerToOrientation,
  smoothOrientation,
  hasAllSensorReadings,
  isValidSensorReading,
  clampPitch,
  headingDifference,
  Orientation,
  SensorReading,
} from './ahrs-orientation';

describe('smoothValue', () => {
  it('should smooth values without wraparound', () => {
    // With smoothing=0.2: result = 100 * 0.2 + 110 * 0.8 = 20 + 88 = 108
    expect(smoothValue(100, 110, 0.2)).toBeCloseTo(108);
  });

  it('should handle zero smoothing (no smoothing)', () => {
    expect(smoothValue(100, 200, 0)).toBe(200);
  });

  it('should handle full smoothing (no change)', () => {
    expect(smoothValue(100, 200, 1)).toBe(100);
  });

  it('should handle wraparound from 350° to 10° (crossing north going east)', () => {
    // 10 becomes 10 - 360 = -350 (since 10 < 350 - 180)
    // result = 350 * 0.2 + (-350) * 0.8 = 70 - 280 = -210... wait that's wrong
    // Let me recalculate: prior=350, next=10
    // next < prior - 180? 10 < 350 - 180 = 170? Yes, so next += 360 -> next = 370
    // result = 350 * 0.2 + 370 * 0.8 = 70 + 296 = 366
    // Hmm, but we don't normalize in smoothValue. Let's check...
    const result = smoothValue(350, 10, 0.2);
    // 10 < 350 - 180 = 170, so next becomes 10 + 360 = 370
    // 350 * 0.2 + 370 * 0.8 = 70 + 296 = 366
    expect(result).toBeCloseTo(366);
  });

  it('should handle wraparound from 10° to 350° (crossing north going west)', () => {
    // prior=10, next=350
    // next > prior + 180? 350 > 10 + 180 = 190? Yes, so next -= 360 -> next = -10
    // result = 10 * 0.2 + (-10) * 0.8 = 2 - 8 = -6
    const result = smoothValue(10, 350, 0.2);
    expect(result).toBeCloseTo(-6);
  });

  it('should not apply wraparound for small changes', () => {
    // 90 to 100: no wraparound needed
    // result = 90 * 0.2 + 100 * 0.8 = 18 + 80 = 98
    expect(smoothValue(90, 100, 0.2)).toBeCloseTo(98);
  });
});

describe('normalizeHeading', () => {
  it('should keep values in [0, 360) unchanged', () => {
    expect(normalizeHeading(0)).toBe(0);
    expect(normalizeHeading(90)).toBe(90);
    expect(normalizeHeading(180)).toBe(180);
    expect(normalizeHeading(270)).toBe(270);
    expect(normalizeHeading(359.9)).toBeCloseTo(359.9);
  });

  it('should normalize 360 to 0', () => {
    expect(normalizeHeading(360)).toBe(0);
  });

  it('should normalize values > 360', () => {
    expect(normalizeHeading(450)).toBe(90);
    expect(normalizeHeading(720)).toBe(0);
    expect(normalizeHeading(370)).toBe(10);
  });

  it('should normalize negative values', () => {
    expect(normalizeHeading(-10)).toBe(350);
    expect(normalizeHeading(-90)).toBe(270);
    expect(normalizeHeading(-180)).toBe(180);
    expect(normalizeHeading(-360)).toBe(0);
    expect(normalizeHeading(-370)).toBe(350);
  });
});

describe('applyDeclination', () => {
  it('should add positive declination (east)', () => {
    // Seattle: ~15° east declination
    expect(applyDeclination(0, 15)).toBe(15);
    expect(applyDeclination(90, 15)).toBe(105);
  });

  it('should add negative declination (west)', () => {
    // East coast: ~-10° west declination
    expect(applyDeclination(0, -10)).toBe(350);
    expect(applyDeclination(90, -10)).toBe(80);
  });

  it('should handle wraparound with declination', () => {
    expect(applyDeclination(350, 20)).toBe(10);
    expect(applyDeclination(10, -20)).toBe(350);
  });

  it('should handle zero declination', () => {
    expect(applyDeclination(45, 0)).toBe(45);
  });
});

describe('convertEulerToOrientation', () => {
  it('should convert without offsets', () => {
    const euler = { heading: 90, pitch: 45, roll: 0 };
    const result = convertEulerToOrientation(euler);
    expect(result.heading).toBe(90);
    expect(result.pitch).toBe(45);
    expect(result.roll).toBe(0);
  });

  it('should apply heading offset', () => {
    const euler = { heading: 90, pitch: 45, roll: 0 };
    const result = convertEulerToOrientation(euler, 180);
    expect(result.heading).toBe(270);
  });

  it('should handle heading offset with wraparound', () => {
    const euler = { heading: 270, pitch: 0, roll: 0 };
    const result = convertEulerToOrientation(euler, 180);
    expect(result.heading).toBe(90);
  });

  it('should invert pitch when specified', () => {
    const euler = { heading: 0, pitch: 45, roll: 0 };
    const result = convertEulerToOrientation(euler, 0, true);
    expect(result.pitch).toBe(-45);
  });

  it('should handle combined offset and inversion', () => {
    const euler = { heading: 90, pitch: -30, roll: 10 };
    const result = convertEulerToOrientation(euler, 180, true);
    expect(result.heading).toBe(270);
    expect(result.pitch).toBe(30);
    expect(result.roll).toBe(10);
  });

  it('should clamp pitch values exceeding 90°', () => {
    const euler = { heading: 0, pitch: 95, roll: 0 };
    const result = convertEulerToOrientation(euler);
    expect(result.pitch).toBe(90);
  });

  it('should clamp pitch values below -90°', () => {
    const euler = { heading: 0, pitch: -100, roll: 0 };
    const result = convertEulerToOrientation(euler);
    expect(result.pitch).toBe(-90);
  });

  it('should clamp inverted pitch that exceeds bounds', () => {
    // pitch = -95, inverted = 95, clamped to 90
    const euler = { heading: 0, pitch: -95, roll: 0 };
    const result = convertEulerToOrientation(euler, 0, true);
    expect(result.pitch).toBe(90);
  });
});

describe('smoothOrientation', () => {
  it('should smooth all orientation components', () => {
    const prior: Orientation = { heading: 100, pitch: 40, roll: 5 };
    const next: Orientation = { heading: 110, pitch: 50, roll: 10 };
    const result = smoothOrientation(prior, next, 0.2);

    // heading: 100 * 0.2 + 110 * 0.8 = 108
    // pitch: 40 * 0.2 + 50 * 0.8 = 48
    // roll: 5 * 0.2 + 10 * 0.8 = 9
    expect(result.heading).toBeCloseTo(108);
    expect(result.pitch).toBeCloseTo(48);
    expect(result.roll).toBeCloseTo(9);
  });

  it('should handle heading wraparound in smoothing', () => {
    const prior: Orientation = { heading: 350, pitch: 0, roll: 0 };
    const next: Orientation = { heading: 10, pitch: 0, roll: 0 };
    const result = smoothOrientation(prior, next, 0.2);

    // Raw smoothed value: 366, normalized to 6
    expect(result.heading).toBeCloseTo(6);
  });

  it('should normalize negative smoothed headings', () => {
    const prior: Orientation = { heading: 10, pitch: 0, roll: 0 };
    const next: Orientation = { heading: 350, pitch: 0, roll: 0 };
    const result = smoothOrientation(prior, next, 0.2);

    // Raw smoothed value: -6, normalized to 354
    expect(result.heading).toBeCloseTo(354);
  });
});

describe('hasAllSensorReadings', () => {
  const validReading: SensorReading = { x: 1, y: 2, z: 3 };

  it('should return true when all sensors have readings', () => {
    expect(hasAllSensorReadings(validReading, validReading, validReading)).toBe(true);
  });

  it('should return false when gyro is null', () => {
    expect(hasAllSensorReadings(null, validReading, validReading)).toBe(false);
  });

  it('should return false when accel is null', () => {
    expect(hasAllSensorReadings(validReading, null, validReading)).toBe(false);
  });

  it('should return false when mag is null', () => {
    expect(hasAllSensorReadings(validReading, validReading, null)).toBe(false);
  });

  it('should return false when all are null', () => {
    expect(hasAllSensorReadings(null, null, null)).toBe(false);
  });
});

describe('isValidSensorReading', () => {
  it('should return true for valid readings', () => {
    expect(isValidSensorReading({ x: 0, y: 0, z: 0 })).toBe(true);
    expect(isValidSensorReading({ x: -1.5, y: 2.5, z: -3.5 })).toBe(true);
    expect(isValidSensorReading({ x: 9.8, y: 0, z: 0 })).toBe(true);
  });

  it('should return false for null', () => {
    expect(isValidSensorReading(null)).toBe(false);
  });

  it('should return false when x is NaN', () => {
    expect(isValidSensorReading({ x: NaN, y: 0, z: 0 })).toBe(false);
  });

  it('should return false when y is Infinity', () => {
    expect(isValidSensorReading({ x: 0, y: Infinity, z: 0 })).toBe(false);
  });

  it('should return false when z is -Infinity', () => {
    expect(isValidSensorReading({ x: 0, y: 0, z: -Infinity })).toBe(false);
  });
});

describe('clampPitch', () => {
  it('should not clamp values within range', () => {
    expect(clampPitch(0)).toBe(0);
    expect(clampPitch(45)).toBe(45);
    expect(clampPitch(-45)).toBe(-45);
    expect(clampPitch(90)).toBe(90);
    expect(clampPitch(-90)).toBe(-90);
  });

  it('should clamp values above 90', () => {
    expect(clampPitch(91)).toBe(90);
    expect(clampPitch(180)).toBe(90);
  });

  it('should clamp values below -90', () => {
    expect(clampPitch(-91)).toBe(-90);
    expect(clampPitch(-180)).toBe(-90);
  });
});

describe('headingDifference', () => {
  it('should calculate simple differences', () => {
    expect(headingDifference(0, 90)).toBe(90);
    expect(headingDifference(90, 0)).toBe(-90);
    expect(headingDifference(0, 180)).toBe(180);
  });

  it('should handle wraparound (shortest path)', () => {
    // From 350 to 10: shortest path is +20, not -340
    expect(headingDifference(350, 10)).toBe(20);

    // From 10 to 350: shortest path is -20, not +340
    expect(headingDifference(10, 350)).toBe(-20);
  });

  it('should return 0 for same headings', () => {
    expect(headingDifference(90, 90)).toBe(0);
    expect(headingDifference(0, 0)).toBe(0);
  });

  it('should handle 180 degree difference', () => {
    expect(headingDifference(0, 180)).toBe(180);
    expect(headingDifference(180, 0)).toBe(-180);
  });

  it('should handle near-180 differences correctly', () => {
    expect(headingDifference(0, 179)).toBe(179);
    expect(headingDifference(0, 181)).toBe(-179);
  });

  it('should handle very small heading differences', () => {
    expect(headingDifference(0, 0.1)).toBeCloseTo(0.1);
    expect(headingDifference(359.9, 0.1)).toBeCloseTo(0.2);
    expect(headingDifference(0.1, 359.9)).toBeCloseTo(-0.2);
  });

  it('should handle sub-degree changes across north', () => {
    // 359.5 -> 0.5: difference should be +1
    expect(headingDifference(359.5, 0.5)).toBeCloseTo(1);
    // 0.5 -> 359.5: difference should be -1
    expect(headingDifference(0.5, 359.5)).toBeCloseTo(-1);
  });
});

describe('integration: smoothing across north', () => {
  // This tests the critical scenario: smooth heading transitions when crossing due north

  it('should smoothly cross north going eastward', () => {
    let heading = 350;

    // Simulate updates going east: 350 -> 355 -> 360/0 -> 5 -> 10
    const updates = [355, 0, 5, 10];

    for (const next of updates) {
      heading = normalizeHeading(smoothValue(heading, next, 0.2));
      // Heading should always be reasonable (no jumps to 180 or similar)
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }

    // Final heading should be close to 10
    expect(heading).toBeGreaterThan(5);
    expect(heading).toBeLessThan(15);
  });

  it('should smoothly cross north going westward', () => {
    let heading = 10;

    // Simulate updates going west: 10 -> 5 -> 0/360 -> 355 -> 350
    const updates = [5, 0, 355, 350];

    for (const next of updates) {
      heading = normalizeHeading(smoothValue(heading, next, 0.2));
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }

    // Final heading should be close to 350
    expect(heading).toBeGreaterThan(345);
    expect(heading).toBeLessThan(360);
  });

  it('should handle rapid back-and-forth north crossings', () => {
    let heading = 355;

    // Simulate oscillating around north: 355 -> 5 -> 358 -> 2 -> 359 -> 1
    const updates = [5, 358, 2, 359, 1, 0, 359, 1];

    for (const next of updates) {
      const prevHeading = heading;
      heading = normalizeHeading(smoothValue(heading, next, 0.2));

      // Should always be valid
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);

      // Should never jump more than ~30° in a single smooth step
      // (with smoothing=0.2, max change is 80% of input change)
      const diff = Math.abs(headingDifference(prevHeading, heading));
      expect(diff).toBeLessThan(30);
    }
  });

  it('should handle sub-degree smoothing across north', () => {
    let heading = 359.8;

    // Very small steps across north
    const updates = [359.9, 0.0, 0.1, 0.2];

    for (const next of updates) {
      heading = normalizeHeading(smoothValue(heading, next, 0.2));
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThan(360);
    }

    // Should end up very close to 0.2
    expect(heading).toBeLessThan(1);
  });
});

describe('integration: orientation at high pitch angles', () => {
  // This tests that our functions work correctly at the problematic 45°+ pitch angles
  // where the original compass flip occurred

  it('should handle orientation at 45° pitch', () => {
    const euler = { heading: 90, pitch: 45, roll: 0 };
    const orientation = convertEulerToOrientation(euler);

    expect(orientation.heading).toBe(90);
    expect(orientation.pitch).toBe(45);
  });

  it('should handle orientation at 60° pitch', () => {
    const euler = { heading: 180, pitch: 60, roll: 0 };
    const orientation = convertEulerToOrientation(euler);

    expect(orientation.heading).toBe(180);
    expect(orientation.pitch).toBe(60);
  });

  it('should handle orientation at 90° pitch (looking straight up)', () => {
    const euler = { heading: 270, pitch: 90, roll: 0 };
    const orientation = convertEulerToOrientation(euler);

    expect(orientation.heading).toBe(270);
    expect(orientation.pitch).toBe(90);
  });

  it('should correctly smooth heading at high pitch', () => {
    // Simulate slow rotation at 60° pitch
    const prior: Orientation = { heading: 90, pitch: 60, roll: 0 };
    const next: Orientation = { heading: 100, pitch: 60, roll: 0 };

    const result = smoothOrientation(prior, next, 0.2);

    // Should smoothly transition, no 180° flip
    expect(result.heading).toBeCloseTo(98);
    expect(result.pitch).toBe(60);
  });

  it('should smooth heading while pitch increases through critical 45° angle', () => {
    // This simulates the real-world scenario: rotating while tilting up
    // Heading crosses north while pitch rises through the problematic 45° threshold
    let orientation: Orientation = { heading: 350, pitch: 40, roll: 0 };

    const updates = [
      { heading: 355, pitch: 43, roll: 0 },
      { heading: 0, pitch: 46, roll: 0 },   // Cross both north AND 45° threshold
      { heading: 5, pitch: 50, roll: 0 },
      { heading: 10, pitch: 55, roll: 0 },
    ];

    for (const next of updates) {
      const prevHeading = orientation.heading;
      orientation = smoothOrientation(orientation, next, 0.2);

      // Pitch should stay valid
      expect(orientation.pitch).toBeGreaterThanOrEqual(-90);
      expect(orientation.pitch).toBeLessThanOrEqual(90);

      // Heading should stay valid and not jump wildly
      expect(orientation.heading).toBeGreaterThanOrEqual(0);
      expect(orientation.heading).toBeLessThan(360);

      // No sudden 180° flip - max change should be reasonable
      const headingChange = Math.abs(headingDifference(prevHeading, orientation.heading));
      expect(headingChange).toBeLessThan(30);
    }

    // Final state should be approaching the last update
    expect(orientation.heading).toBeLessThan(15);
    expect(orientation.pitch).toBeGreaterThan(45);
  });

  it('should handle continuous rotation at 60° pitch crossing all cardinal directions', () => {
    // Full 360° rotation at high pitch
    let orientation: Orientation = { heading: 0, pitch: 60, roll: 0 };

    // Rotate through N -> E -> S -> W -> N
    const updates = [
      { heading: 45, pitch: 60, roll: 0 },
      { heading: 90, pitch: 60, roll: 0 },
      { heading: 135, pitch: 60, roll: 0 },
      { heading: 180, pitch: 60, roll: 0 },
      { heading: 225, pitch: 60, roll: 0 },
      { heading: 270, pitch: 60, roll: 0 },
      { heading: 315, pitch: 60, roll: 0 },
      { heading: 0, pitch: 60, roll: 0 },
    ];

    for (const next of updates) {
      const prevHeading = orientation.heading;
      orientation = smoothOrientation(orientation, next, 0.2);

      // Verify no discontinuities
      const headingChange = Math.abs(headingDifference(prevHeading, orientation.heading));
      expect(headingChange).toBeLessThan(50); // ~45° steps, smoothed
    }
  });
});

describe('integration: 45° flip problem documentation', () => {
  /**
   * IMPORTANT: Understanding the 45° compass flip problem
   *
   * The iPhone's built-in compass (Location.watchHeadingAsync) has a known issue
   * where it flips the heading by 180° when device pitch exceeds ~45°.
   *
   * These utility functions DO NOT prevent this flip directly. Instead:
   * 1. The flip is prevented by using raw magnetometer data via AHRS
   * 2. The Madgwick filter computes heading from raw sensors without Apple's processing
   * 3. These functions handle the AHRS output correctly at all pitch angles
   *
   * The tests below verify that IF a 180° flip somehow occurred in the input,
   * our smoothing would dampen it rather than pass it through instantly.
   */

  it('should dampen a sudden 180° heading change (simulating corrupted data)', () => {
    // If bad data comes in with a 180° flip, smoothing should dampen it
    const prior: Orientation = { heading: 90, pitch: 50, roll: 0 };
    const flipped: Orientation = { heading: 270, pitch: 50, roll: 0 }; // 180° flip!

    const result = smoothOrientation(prior, flipped, 0.2);

    // With smoothing=0.2, we move 80% toward the new value
    // But the smoothing should take the SHORT path around the circle
    // 90 -> 270 via shortest path is actually -180° (or +180°)
    // smoothValue will see 270 > 90 + 180, so it subtracts 360: 270-360 = -90
    // Result: 90 * 0.2 + (-90) * 0.8 = 18 - 72 = -54, normalized to 306

    // The key point: we don't instantly jump to 270
    expect(result.heading).not.toBe(270);

    // The smoothed result dampens the change
    const change = Math.abs(headingDifference(prior.heading, result.heading));
    expect(change).toBeLessThan(180); // Not a full flip
  });

  it('should demonstrate that smoothing alone cannot fully prevent flips', () => {
    // This test documents that multiple consecutive bad readings WOULD
    // eventually cause the heading to flip. The real solution is in the
    // AHRS filter providing correct data, not in post-processing.

    let orientation: Orientation = { heading: 90, pitch: 50, roll: 0 };

    // Simulate several frames of "flipped" data (heading jumped to 270)
    const flippedReadings = Array(20).fill({ heading: 270, pitch: 50, roll: 0 });

    for (const next of flippedReadings) {
      orientation = smoothOrientation(orientation, next, 0.2);
    }

    // After many frames of consistent "wrong" data, smoothing converges to it
    // This demonstrates why we need correct AHRS output, not just smoothing
    expect(orientation.heading).toBeCloseTo(270, 0);
  });
});
