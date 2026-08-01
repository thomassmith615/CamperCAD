/**
 * Electrical system vocabulary.
 *
 * This subsystem sizes three things: how much energy the build uses, how much
 * battery and solar it needs to cover that, and how thick every wire has to be.
 *
 * The third is safety-critical. An undersized wire does not fail gracefully —
 * it heats, degrades its insulation and eventually ignites, usually inside a
 * wall where nobody will see it. The tables below are therefore published
 * standards rather than rules of thumb, and their provenance is carried through
 * to the UI so a builder can check them against the source.
 */

/** Nominal system voltages. */
export type SystemVoltage = 12 | 24;

/** Wire sizes in American Wire Gauge, ordered smallest conductor first. */
export type AwgSize =
  | '18'
  | '16'
  | '14'
  | '12'
  | '10'
  | '8'
  | '6'
  | '4'
  | '2'
  | '1'
  | '1/0'
  | '2/0'
  | '3/0'
  | '4/0';

/** One row of the conductor table. */
export interface WireSpec {
  size: AwgSize;
  /**
   * Current-carrying capacity in amps.
   *
   * ABYC E-11 Table VI, 105 °C insulation, conductors **outside** engine
   * spaces and not bundled. A conversion's wiring is almost entirely outside
   * the engine bay; anything routed through it derates substantially and this
   * table would overstate it.
   */
  ampacity: number;
  /**
   * Resistance in ohms per 1000 feet of conductor, annealed copper at 75 °C.
   *
   * Quoted warm rather than at 20 °C because a loaded wire in an insulated van
   * wall runs warm, and resistance rises with temperature — using the cold
   * figure would understate voltage drop exactly when it matters most.
   */
  ohmsPerThousandFeet: number;
}

/**
 * Conductor table.
 *
 * Aluminium is deliberately absent: it is cheaper per amp and wrong for a
 * vehicle, where vibration and thermal cycling loosen terminations over time.
 */
export const WIRE_TABLE: readonly WireSpec[] = [
  { size: '18', ampacity: 20, ohmsPerThousandFeet: 7.77 },
  { size: '16', ampacity: 25, ohmsPerThousandFeet: 4.89 },
  { size: '14', ampacity: 35, ohmsPerThousandFeet: 3.07 },
  { size: '12', ampacity: 45, ohmsPerThousandFeet: 1.93 },
  { size: '10', ampacity: 60, ohmsPerThousandFeet: 1.21 },
  { size: '8', ampacity: 80, ohmsPerThousandFeet: 0.764 },
  { size: '6', ampacity: 120, ohmsPerThousandFeet: 0.491 },
  { size: '4', ampacity: 160, ohmsPerThousandFeet: 0.308 },
  { size: '2', ampacity: 210, ohmsPerThousandFeet: 0.194 },
  { size: '1', ampacity: 245, ohmsPerThousandFeet: 0.154 },
  { size: '1/0', ampacity: 285, ohmsPerThousandFeet: 0.122 },
  { size: '2/0', ampacity: 330, ohmsPerThousandFeet: 0.0967 },
  { size: '3/0', ampacity: 385, ohmsPerThousandFeet: 0.0766 },
  { size: '4/0', ampacity: 445, ohmsPerThousandFeet: 0.0608 },
];

/**
 * Voltage drop budgets, as a fraction of system voltage.
 *
 * ABYC distinguishes circuits where a drop degrades safety — panel feeds,
 * navigation, bilge — from those where it merely wastes energy. Three percent
 * is the strict budget; ten percent is acceptable for lighting and
 * conveniences. CamperCAD applies the strict budget by default because the
 * difference in wire cost across a van is small and the difference in a
 * marginal fridge compressor starting on a cold morning is not.
 */
export const DROP_BUDGET = { critical: 0.03, general: 0.1 } as const;

/** How a load is powered. */
export type LoadKind = 'dc' | 'ac';

/** One electrical load in the design. */
export interface LoadEntry {
  /** Object name. */
  name: string;
  kind: LoadKind;
  /** Continuous draw in watts while running. */
  watts: number;
  /** Hours of running per day, averaged. */
  hoursPerDay: number;
  /** Energy per day in watt-hours, before inverter losses. */
  dailyWattHours: number;
  /** Current drawn from the battery in amps, including inverter losses. */
  batteryAmps: number;
  /** Straight-line distance from the battery, in inches. */
  distanceFromBattery: number | null;
}

/** A sized circuit. */
export interface CircuitPlan {
  load: LoadEntry;
  /** One-way run length in feet, after routing allowance. */
  runFeet: number;
  /** Gauge chosen to satisfy both ampacity and voltage drop. */
  size: AwgSize | null;
  /** Which constraint decided the gauge. */
  limitedBy: 'ampacity' | 'voltage-drop' | 'none';
  /** Actual drop at the chosen gauge, as a fraction of system voltage. */
  actualDrop: number;
  /** Recommended fuse or breaker rating in amps. */
  fuseAmps: number;
  /** Set when nothing in the table satisfies the requirement. */
  problem: string | null;
}

/** Battery bank and generation summary. */
export interface PowerBudget {
  systemVoltage: SystemVoltage;
  /** Total daily consumption in watt-hours. */
  dailyWattHours: number;
  /** Installed battery capacity in amp-hours at system voltage. */
  batteryAmpHours: number;
  /** Usable energy in watt-hours, after depth-of-discharge limits. */
  usableWattHours: number;
  /** Days the bank runs the loads with no charging at all. */
  daysOfAutonomy: number;
  /** Installed solar in watts. */
  solarWatts: number;
  /** Realistic daily solar harvest in watt-hours, per season. */
  solarSummer: number;
  solarWinter: number;
  /** Installed inverter capacity in watts. */
  inverterWatts: number;
  /** Largest simultaneous AC draw the design implies. */
  peakAcWatts: number;
  /** Plain-language problems, worst first. */
  warnings: string[];
}

/** A complete electrical report. */
export interface ElectricalReport {
  loads: LoadEntry[];
  circuits: CircuitPlan[];
  budget: PowerBudget;
  /** True when a battery was found and wire runs could be measured. */
  hasBattery: boolean;
}

/**
 * Usable fraction of nominal battery capacity.
 *
 * Lithium iron phosphate tolerates deep discharge, and the industry commonly
 * quotes 80%. That is achievable but leaves nothing in reserve, so 80% is used
 * for the headline figure and the panel says what it assumes.
 */
export const USABLE_FRACTION = 0.8;

/**
 * Inverter conversion efficiency.
 *
 * A good pure-sine inverter is about 90% efficient at moderate load and worse
 * at very light load. Every AC watt therefore costs roughly 1.11 battery watts,
 * which is why running a kettle off a van battery is expensive twice over.
 */
export const INVERTER_EFFICIENCY = 0.9;

/**
 * Peak sun hours used for the solar estimate.
 *
 * These are **flat-mounted, mid-latitude** figures, not panel ratings. A roof
 * panel lies horizontal, so it never sees the angle a tilted array does, and it
 * runs hot, which costs more output again. Quoting 5 or 6 hours as some
 * calculators do produces numbers a real van never achieves in winter.
 */
export const SUN_HOURS = { summer: 4.5, winter: 1.5 } as const;

/**
 * Combined derate for a flat rooftop array.
 *
 * Accounts for controller efficiency, wiring, temperature, soiling and the
 * fact that a van is frequently parked in partial shade because shade is where
 * people want to be.
 */
export const SOLAR_DERATE = 0.7;

/**
 * Routing allowance applied to straight-line distances.
 *
 * Wire does not run diagonally through a cabinet. It follows walls and floors,
 * which costs roughly 40% over the direct distance, plus slack at each end for
 * service loops. Underestimating run length underestimates voltage drop, so
 * this errs generously.
 */
export const ROUTING_FACTOR = 1.4;

/** Extra wire allowed at each end for terminations and service loops, in feet. */
export const SERVICE_SLACK_FEET = 2;
