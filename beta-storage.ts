/**
 * AsyncStorage utilities for AHRS beta parameter persistence
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const BETA_STORAGE_KEY = '@heliotrope_ahrs_beta';

export const DEFAULT_BETA = 0.1;
export const MIN_BETA = 0.01;
export const MAX_BETA = 0.30;

/**
 * Load beta value from AsyncStorage.
 * Returns DEFAULT_BETA if no value stored or on error.
 */
export async function loadBeta(): Promise<number> {
  try {
    const value = await AsyncStorage.getItem(BETA_STORAGE_KEY);
    if (value !== null) {
      const parsed = parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= MIN_BETA && parsed <= MAX_BETA) {
        return parsed;
      }
    }
    return DEFAULT_BETA;
  } catch (e) {
    console.warn('Failed to load beta from storage:', e);
    return DEFAULT_BETA;
  }
}

/**
 * Save beta value to AsyncStorage.
 * Validates input and clamps to valid range before saving.
 */
export async function saveBeta(beta: number): Promise<void> {
  // Reject invalid input
  if (!Number.isFinite(beta)) {
    console.warn('Invalid beta value, not saving:', beta);
    return;
  }

  try {
    const clampedBeta = Math.max(MIN_BETA, Math.min(MAX_BETA, beta));
    await AsyncStorage.setItem(BETA_STORAGE_KEY, clampedBeta.toString());
  } catch (e) {
    console.warn('Failed to save beta to storage:', e);
  }
}

/**
 * Generate array of valid beta values for picker.
 * Returns [0.01, 0.02, ..., 0.30] with exact precision.
 */
export function generateBetaValues(): number[] {
  const values: number[] = [];
  for (let i = Math.round(MIN_BETA * 100); i <= Math.round(MAX_BETA * 100); i++) {
    // Round to avoid floating point precision issues
    values.push(Math.round(i) / 100);
  }
  return values;
}
