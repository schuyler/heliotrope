# AHRS Implementation Guide for Heliotrope React Native

## Overview

This guide implements Madgwick AHRS filter to replace the current orientation tracking system. This eliminates the 45° compass flip and reduces jitter through proper sensor fusion.

**Goal:** Replace `Location.watchHeadingAsync()` + `DeviceMotion` with AHRS-based orientation tracking.

**Expected outcome:** Stable heading and pitch at all elevation angles, including >45°.

---

## Prerequisites

### Install Dependencies

```bash
npm install ahrs
npm install geomagnetism  # For magnetic declination
```

### Sensor Requirements

You'll use three sensors from `expo-sensors`:
- `Gyroscope` - rotation rate
- `Accelerometer` - gravity vector
- `Magnetometer` - magnetic field vector

---

## Implementation Steps

### Step 1: Import Required Modules

Add to `App.tsx`:

```typescript
import { Gyroscope, Accelerometer, Magnetometer } from 'expo-sensors';
import { Madgwick } from 'ahrs';
import geomagnetism from 'geomagnetism';
```

### Step 2: Initialize AHRS Filter

Add to your state/component setup:

```typescript
// Initialize Madgwick filter (outside component or in useRef)
const madgwick = new Madgwick({
  sampleInterval: 20,  // 50Hz update rate
  beta: 0.1           // Start here, tune later
});

// Sensor readings storage
let gyroData: { x: number, y: number, z: number } | null = null;
let accelData: { x: number, y: number, z: number } | null = null;
let magData: { x: number, y: number, z: number } | null = null;

// Declination for true north correction
let declination: number = 0;
```

### Step 3: Set Up Sensor Subscriptions

Replace your current sensor subscriptions in `useEffect`:

```typescript
// Set update interval for all sensors (50Hz = 20ms)
const updateInterval = 20;
Gyroscope.setUpdateInterval(updateInterval);
Accelerometer.setUpdateInterval(updateInterval);
Magnetometer.setUpdateInterval(updateInterval);

// Subscribe to gyroscope
const gyroSubscription = Gyroscope.addListener((data) => {
  gyroData = data;
  updateOrientationAHRS();
});

// Subscribe to accelerometer
const accelSubscription = Accelerometer.addListener((data) => {
  accelData = data;
  updateOrientationAHRS();
});

// Subscribe to magnetometer
const magSubscription = Magnetometer.addListener((data) => {
  magData = data;
  updateOrientationAHRS();
});
```

### Step 4: Calculate Magnetic Declination

After getting location, calculate declination:

```typescript
const lastKnownLocation = await Location.getLastKnownPositionAsync();
if (lastKnownLocation) {
  setLocation(lastKnownLocation.coords);
  
  // Calculate magnetic declination
  const geoMag = geomagnetism.model().point([
    lastKnownLocation.coords.latitude,
    lastKnownLocation.coords.longitude
  ]);
  declination = geoMag.decl;  // Degrees
  
  solarTable = generateSolarTable(lastKnownLocation.coords);
}
```

### Step 5: Implement AHRS Update Function

Replace `updateOrientation()` with:

```typescript
const updateOrientationAHRS = () => {
  // Wait until we have all three sensor readings
  if (!gyroData || !accelData || !magData || !solarTable) return;
  
  // Update Madgwick filter
  madgwick.update(
    gyroData.x, gyroData.y, gyroData.z,       // rad/s
    accelData.x, accelData.y, accelData.z,    // g
    magData.x, magData.y, magData.z           // µT
  );
  
  // Get Euler angles
  const euler = madgwick.getEulerAngles();
  
  // Extract orientation
  // Note: May need coordinate system conversion depending on AHRS output
  let heading = euler.heading;  // Magnetic heading in degrees
  let pitch = euler.pitch;      // Pitch in degrees
  
  // Apply declination for true heading
  heading = (heading + declination + 360) % 360;
  
  // Apply smoothing if needed (start without, add if necessary)
  if (priorOrientation) {
    pitch = smoothValues(priorOrientation.pitch, pitch, 0.1);
    heading = smoothValues(priorOrientation.heading, heading, 0.1);
  }
  
  setOrientation({ pitch, heading });
  priorOrientation = { pitch, heading };
  
  // Update solar position
  const tableEntry = Math.floor(heading);
  setSolarPosition(solarTable[tableEntry]);
};
```

### Step 6: Clean Up Subscriptions

Update your cleanup in `useEffect` return:

```typescript
return () => {
  gyroSubscription?.remove();
  accelSubscription?.remove();
  magSubscription?.remove();
};
```

### Step 7: Remove Old Code

Delete or comment out:
- `Location.watchHeadingAsync()` subscription
- The 45° flip workaround (lines 218-224)
- `DeviceMotion` usage (no longer needed)

---

## Coordinate System Notes

**Important:** AHRS libraries may use different coordinate systems than Expo. You may need to swap or negate axes.

**Test this first:** Point phone north flat on table. If heading isn't ~0°, you need coordinate conversion.

Common conversions:
```typescript
// If heading is 180° off:
heading = (heading + 180) % 360;

// If pitch is inverted:
pitch = -pitch;

// Check AHRS library docs for expected coordinate system
```

---

## Tuning Guide

### Beta Parameter Tuning

1. **Start:** beta = 0.1
2. **Test:** Point phone at sky (45-90° elevation), rotate slowly 360°
3. **Observe:**
   - Jittery/noisy → **decrease** beta (0.05, 0.03)
   - Laggy/sluggish → **increase** beta (0.15, 0.2)
4. **Test extremes:**
   - Rapid rotations (should respond quickly)
   - Hold still (should be stable, minimal drift)
5. **Iterate:** Adjust in 0.05 increments

**Typical good values:** 0.05 - 0.15

### Update Frequency Tuning

Start with 50Hz (20ms interval). If too slow:
- Try 100Hz (10ms) - better tracking, more battery
- Try 30Hz (33ms) - smoother, less battery

Match all three sensors to same rate.

### Smoothing

Start **without** additional smoothing - AHRS handles this internally.

If still jittery, add light smoothing:
```typescript
smoothing = 0.1  // Very light
smoothing = 0.2  // Light (probably max needed)
```

---

## Testing Checklist

### Basic Functionality
- [ ] App launches without errors
- [ ] Sensors initialize successfully
- [ ] Sun icon appears on screen
- [ ] Compass heading updates

### Orientation Tests
- [ ] **Flat (0° pitch):** Heading tracks correctly when rotating device
- [ ] **45° pitch:** Heading remains stable (no flip)
- [ ] **90° pitch (straight up):** Heading remains stable
- [ ] **-45° pitch (down):** Heading remains stable
- [ ] **Continuous rotation:** Smooth tracking with no jumps

### Cardinal Direction Tests
- [ ] Point north → heading ~0°
- [ ] Point east → heading ~90°
- [ ] Point south → heading ~180°
- [ ] Point west → heading ~270°

### Duration Test
- [ ] Hold at 60° elevation for 2 minutes → minimal drift (<5°)

### Edge Cases
- [ ] Rapid movements → responsive without overshoot
- [ ] Hold perfectly still → stable (no vibration)
- [ ] Transition through 45° → smooth (no discontinuity)

---

## Troubleshooting

### Heading is 180° off
```typescript
heading = (heading + 180) % 360;
```

### Pitch is inverted
```typescript
pitch = -pitch;
```

### Heading drifts significantly
- Increase beta (trust correction sensors more)
- Verify magnetometer calibration (figure-8 motion)
- Check for magnetic interference

### Too jittery
- Decrease beta
- Add light smoothing (0.1-0.2 factor)
- Reduce sensor update rate slightly

### Too laggy
- Increase beta
- Reduce smoothing factor
- Increase sensor update rate

### Sensors not updating
```typescript
// Check permissions
const { status } = await Gyroscope.requestPermissionsAsync();
console.log('Gyroscope permission:', status);

// Verify sensor availability
const isAvailable = await Gyroscope.isAvailableAsync();
console.log('Gyroscope available:', isAvailable);
```

### Declination incorrect
- Verify latitude/longitude are correct
- Check geomagnetism calculation
- Expected range: -30° to +30° for most locations

---

## Performance Notes

**Battery impact:** ~10-15% more than current implementation (three sensors at 50Hz)

**CPU usage:** Minimal - AHRS is lightweight math

**Memory:** Negligible increase

---

## Success Criteria

✅ **No 45° flip** - heading stable at all pitch angles  
✅ **Reduced jitter** - smooth tracking when holding still  
✅ **Responsive** - updates feel immediate when rotating  
✅ **Accurate** - heading matches actual compass direction within 5°  

---

## Next Steps After Implementation

1. Test outdoors in actual camping scenario
2. Compare to sun's actual position (use Compass app for reference)
3. Document final beta value that works best
4. Consider if native port is still necessary

---

## Fallback Plan

If AHRS doesn't improve quality enough:
- Proceed with native iOS/ARKit port per PRD
- AHRS proves whether sensor fusion is the issue or if JavaScript frequency is the bottleneck
