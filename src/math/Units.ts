/**
 * Unit handling for CamperCAD.
 *
 * The scene graph works in a single internal unit: **inches**. Every length in
 * the application — geometry, positions, grid spacing, snap tolerances — is an
 * inch value, so no conversion happens during simulation or hit testing.
 * Conversion exists only at the boundaries: parsing user input and formatting
 * values for display.
 *
 * Vans are specified in inches in North America and in millimetres everywhere
 * else, so both must be first-class for input as well as output.
 */

/** Units a value can be presented in. Internal storage is always inches. */
export type DisplayUnit = 'in' | 'ft-in' | 'mm' | 'cm' | 'm';

/** Inches per one unit of each display system. */
const INCHES_PER: Record<Exclude<DisplayUnit, 'ft-in'>, number> = {
  in: 1,
  mm: 1 / 25.4,
  cm: 1 / 2.54,
  m: 1 / 0.0254,
};

/** Human-readable labels, used in menus and the status bar. */
export const UNIT_LABELS: Record<DisplayUnit, string> = {
  in: 'Inches',
  'ft-in': 'Feet & inches',
  mm: 'Millimetres',
  cm: 'Centimetres',
  m: 'Metres',
};

/** True when the unit belongs to the metric system. */
export function isMetric(unit: DisplayUnit): boolean {
  return unit === 'mm' || unit === 'cm' || unit === 'm';
}

/** Converts an internal inch value into the given display unit. */
export function fromInches(inches: number, unit: DisplayUnit): number {
  if (unit === 'ft-in') return inches;
  return inches / INCHES_PER[unit];
}

/** Converts a value expressed in `unit` back into internal inches. */
export function toInches(value: number, unit: DisplayUnit): number {
  if (unit === 'ft-in') return value;
  return value * INCHES_PER[unit];
}

/** Rounds to a fixed number of decimals without exponent notation artefacts. */
function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Decimal places that read naturally for each unit at van scale. */
const DECIMALS: Record<DisplayUnit, number> = {
  in: 2,
  'ft-in': 2,
  mm: 0,
  cm: 1,
  m: 3,
};

/**
 * Formats an internal inch length for display, e.g. `72.5"`, `6' 0.5"`,
 * `1841 mm`. Values are rounded to a precision appropriate to the unit rather
 * than a fixed decimal count, so millimetres never show meaningless digits.
 */
export function formatLength(inches: number, unit: DisplayUnit): string {
  if (unit === 'ft-in') {
    const sign = inches < 0 ? '-' : '';
    const abs = Math.abs(inches);
    let feet = Math.floor(abs / 12);
    let rem = round(abs - feet * 12, 2);
    if (rem >= 12) {
      feet += 1;
      rem -= 12;
    }
    return rem === 0 ? `${sign}${feet}'` : `${sign}${feet}' ${rem}"`;
  }

  const value = round(fromInches(inches, unit), DECIMALS[unit]);
  return unit === 'in' ? `${value}"` : `${value} ${unit}`;
}

/** Formats an angle in radians as whole or one-decimal degrees. */
export function formatAngle(radians: number): string {
  return `${round((radians * 180) / Math.PI, 1)}°`;
}

/**
 * Parses user-typed length input into internal inches, accepting the notations
 * builders actually type: `36`, `36in`, `3'`, `3' 6"`, `3ft6`, `914mm`, `0.9m`.
 * Returns `null` when the text cannot be interpreted, so callers can reject the
 * edit and restore the previous value rather than silently writing NaN.
 *
 * @param text Raw input text.
 * @param fallbackUnit Unit assumed when the text carries no explicit suffix.
 */
export function parseLength(text: string, fallbackUnit: DisplayUnit): number | null {
  const source = text.trim().toLowerCase();
  if (source === '') return null;

  const feetInches = source.match(/^(-?\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(\d+(?:\.\d+)?)?\s*(?:"|in|inch(?:es)?)?$/);
  if (feetInches) {
    const feet = Number.parseFloat(feetInches[1]);
    const inches = feetInches[2] ? Number.parseFloat(feetInches[2]) : 0;
    return feet < 0 ? feet * 12 - inches : feet * 12 + inches;
  }

  const suffixed = source.match(/^(-?\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|)$/);
  if (!suffixed) return null;

  const value = Number.parseFloat(suffixed[1]);
  if (!Number.isFinite(value)) return null;

  switch (suffixed[2]) {
    case 'mm':
      return toInches(value, 'mm');
    case 'cm':
      return toInches(value, 'cm');
    case 'm':
      return toInches(value, 'm');
    case 'in':
    case '"':
      return value;
    default:
      return toInches(value, fallbackUnit === 'ft-in' ? 'in' : fallbackUnit);
  }
}
