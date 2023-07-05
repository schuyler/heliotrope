/*
    adapted from https://github.com/expo/expo/discussions/7893 ...
    which I assume to be licensed under the same terms as Expo itself.
*/

const halfPI = Math.PI * 0.5;

export type Rotation = {
  alpha: number;
  beta: number;
  gamma: number;
};

function attitudeTo3x3Matrix(rotation: Rotation): number[] {
  // zxy (yaw roll pitch)

  const [roll, pitch, yaw] = [rotation.alpha, rotation.beta, rotation.gamma];

  const yawSin = Math.sin(yaw);
  const rollSin = Math.sin(roll);
  const pitchSin = Math.sin(pitch);

  const yawCos = Math.cos(yaw);
  const rollCos = Math.cos(roll);
  const pitchCos = Math.cos(pitch);

  // Z
  const rotationZ0 = yawCos * rollCos - yawSin * pitchSin * rollSin;
  const rotationZ1 = -pitchCos * yawSin;
  const rotationZ2 = rollCos * yawSin * pitchSin + yawCos * rollSin;
  // X
  const rotationX0 = rollCos * yawSin + yawCos * pitchSin * rollSin;
  const rotationX1 = yawCos * pitchCos;
  const rotationX2 = yawSin * rollSin - yawCos * rollCos * pitchSin;
  // Y
  const rotationY0 = -pitchCos * rollSin;
  const rotationY1 = pitchSin;
  const rotationY2 = pitchCos * rollCos;

  return [
    rotationZ0,
    rotationZ1,
    rotationZ2,
    rotationX0,
    rotationX1,
    rotationX2,
    rotationY0,
    rotationY1,
    rotationY2,
  ];
}

function orientationMatrixToOrientation(orientation: number[]) {
  const [rot1, rot2, _rot3, rot4, rot5, _rot6, rot7, rot8, rot9] = orientation;

  let rotationAlpha;
  let rotationBeta;
  let rotationGamma;

  if (rot9 > 0) {
    rotationAlpha = Math.atan2(-rot2, rot5);
    rotationBeta = Math.asin(rot8);
    rotationGamma = Math.atan2(-rot7, rot9);
  } else if (rot9 < 0) {
    rotationAlpha = Math.atan2(rot2, -rot5);
    rotationBeta = -Math.asin(rot8);
    rotationBeta += rotationBeta < 0 ? Math.PI : -Math.PI;
    rotationGamma = Math.atan2(rot7, -rot9);
  } else {
    if (rot7 > 0) {
      rotationAlpha = Math.atan2(-rot2, rot5);
      rotationBeta = Math.asin(rot8);
      rotationGamma = -halfPI;
    } else if (rot7 < 0) {
      rotationAlpha = Math.atan2(rot2, -rot5);
      rotationBeta = -Math.asin(rot8);
      rotationBeta += rotationBeta < 0 ? Math.PI : -Math.PI;
      rotationGamma = -halfPI;
    } else {
      rotationAlpha = Math.atan2(rot4, rot1);
      rotationBeta = rot8 <= 0 ? -halfPI : halfPI;
      rotationGamma = 0;
    }
  }

  if (rotationAlpha <= 0) {
    rotationAlpha = Math.PI * 2 + rotationAlpha;
  }

  return [rotationAlpha, rotationBeta, rotationGamma];
}

function radiansToDegrees(radians: number) {
  return (radians * 180) / Math.PI;
}

export function transformOrientation(sensorReading: Rotation): Rotation {
  const matrix = attitudeTo3x3Matrix(sensorReading);
  const [rotationAlpha, rotationBeta, rotationGamma] =
    orientationMatrixToOrientation(matrix);

  const alpha = radiansToDegrees(rotationAlpha);
  const beta = radiansToDegrees(rotationBeta);
  const gamma = radiansToDegrees(rotationGamma);

  return { alpha, beta, gamma };
}
