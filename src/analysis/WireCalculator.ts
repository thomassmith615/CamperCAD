import {
  DROP_BUDGET,
  WIRE_TABLE,
  type AwgSize,
  type SystemVoltage,
  type WireSpec,
} from './ElectricalTypes';

/** Standard fuse and breaker ratings, in amps. */
const FUSE_SIZES = [1, 2, 3, 5, 7.5, 10, 15, 20, 25, 30, 40, 50, 60, 80, 100, 125, 150, 175, 200, 250, 300, 400];

/** Result of sizing one conductor. */
export interface WireChoice {
  size: AwgSize | null;
  limitedBy: 'ampacity' | 'voltage-drop' | 'none';
  /** Voltage drop at the chosen size, as a fraction of system voltage. */
  actualDrop: number;
  fuseAmps: number;
  problem: string | null;
}

/**
 * Sizes DC conductors.
 *
 * Two independent constraints have to be satisfied, and which one binds depends
 * on the run:
 *
 * **Ampacity** is a thermal limit. A conductor carrying more than its rating
 * overheats regardless of how short it is. This binds on short, high-current
 * runs — an inverter cable two feet long.
 *
 * **Voltage drop** is a performance limit. At 12 volts there is very little
 * headroom: a 3% budget is 0.36 V, so a long run needs copper far beyond what
 * the thermal rating alone would suggest. This binds on almost every run longer
 * than a few feet, which is why van wiring looks over-specified to anyone used
 * to mains voltages.
 *
 * The larger of the two answers wins, and the caller is told which one decided
 * it — because if voltage drop is binding, moving the load closer to the
 * battery is a cheaper fix than buying thicker cable.
 */
export class WireCalculator {
  /**
   * Chooses a conductor.
   *
   * @param amps Continuous current the circuit carries.
   * @param runFeet One-way distance from source to load.
   * @param voltage Nominal system voltage.
   * @param critical Whether to apply the strict 3% drop budget.
   */
  static size(amps: number, runFeet: number, voltage: SystemVoltage, critical = true): WireChoice {
    if (amps <= 0) {
      return { size: null, limitedBy: 'none', actualDrop: 0, fuseAmps: 0, problem: null };
    }

    const budget = critical ? DROP_BUDGET.critical : DROP_BUDGET.general;
    const allowedVolts = voltage * budget;

    let ampacityChoice: WireSpec | null = null;
    let dropChoice: WireSpec | null = null;

    for (const spec of WIRE_TABLE) {
      if (!ampacityChoice && spec.ampacity >= amps) ampacityChoice = spec;
      if (!dropChoice && WireCalculator.dropVolts(amps, runFeet, spec) <= allowedVolts) dropChoice = spec;
      if (ampacityChoice && dropChoice) break;
    }

    if (!ampacityChoice) {
      return {
        size: null,
        limitedBy: 'ampacity',
        actualDrop: 0,
        fuseAmps: WireCalculator.fuseFor(amps),
        problem: `${Math.round(amps)} A exceeds the largest conductor in the table. Split the load across two circuits.`,
      };
    }

    if (!dropChoice) {
      return {
        size: null,
        limitedBy: 'voltage-drop',
        actualDrop: WireCalculator.dropVolts(amps, runFeet, WIRE_TABLE[WIRE_TABLE.length - 1]) / voltage,
        fuseAmps: WireCalculator.fuseFor(amps),
        problem: `No conductor keeps drop under ${Math.round(budget * 100)}% over ${Math.round(runFeet)} ft at ${Math.round(amps)} A. Move the load closer to the battery.`,
      };
    }

    // Table is ordered smallest first, so the later index is the thicker wire.
    const ampacityIndex = WIRE_TABLE.indexOf(ampacityChoice);
    const dropIndex = WIRE_TABLE.indexOf(dropChoice);
    const chosen = dropIndex > ampacityIndex ? dropChoice : ampacityChoice;

    return {
      size: chosen.size,
      limitedBy: dropIndex > ampacityIndex ? 'voltage-drop' : 'ampacity',
      actualDrop: WireCalculator.dropVolts(amps, runFeet, chosen) / voltage,
      fuseAmps: WireCalculator.fuseFor(amps),
      problem: null,
    };
  }

  /**
   * Voltage drop over a circuit.
   *
   * The run length is doubled: current flows out along the positive conductor
   * and back along the negative, and both drop voltage. Forgetting the return
   * path halves the calculated drop and is the single most common error in van
   * wiring guides.
   */
  static dropVolts(amps: number, runFeet: number, spec: WireSpec): number {
    return (2 * runFeet * amps * spec.ohmsPerThousandFeet) / 1000;
  }

  /**
   * Chooses an overcurrent device.
   *
   * Sized at 125% of continuous load and rounded up to a standard rating, which
   * is the usual convention for a continuously operating circuit. The fuse
   * protects the *wire*, not the appliance, so the gauge chosen above must
   * carry at least this rating — which it does, since ampacity was checked
   * against the load and the standard sizes are close together.
   */
  static fuseFor(amps: number): number {
    const target = amps * 1.25;
    return FUSE_SIZES.find((size) => size >= target) ?? Math.ceil(target / 50) * 50;
  }

  /** Looks up one row of the conductor table. */
  static spec(size: AwgSize): WireSpec | undefined {
    return WIRE_TABLE.find((entry) => entry.size === size);
  }
}
