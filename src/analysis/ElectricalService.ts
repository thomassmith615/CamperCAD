import * as THREE from 'three';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import { WireCalculator } from './WireCalculator';
import {
  INVERTER_EFFICIENCY,
  ROUTING_FACTOR,
  SERVICE_SLACK_FEET,
  SOLAR_DERATE,
  SUN_HOURS,
  USABLE_FRACTION,
  type CircuitPlan,
  type ElectricalReport,
  type LoadEntry,
  type PowerBudget,
  type SystemVoltage,
} from './ElectricalTypes';

/**
 * Derives the electrical system from what is actually in the van.
 *
 * Loads are not a separate list the user maintains alongside the model — they
 * are the objects they already placed. A fridge dropped into the galley is a
 * 45 W load at the position it sits, and moving it changes its wire run. That
 * coupling is the reason to do electrical design inside a CAD tool rather than
 * in a spreadsheet: the spreadsheet cannot tell you that the run to the fridge
 * got eleven feet longer when you moved the galley aft.
 *
 * Battery position is taken from the largest battery in the design, since that
 * is where the bus bars live in practice.
 */
export class ElectricalService {
  private readonly store: ObjectStore;
  private voltage: SystemVoltage = 12;

  constructor(store: ObjectStore) {
    this.store = store;
  }

  /** Nominal system voltage. */
  get systemVoltage(): SystemVoltage {
    return this.voltage;
  }

  /**
   * Changes the system voltage.
   *
   * At 24 V every current halves, which quarters voltage-drop losses and lets
   * far thinner cable do the same job. It is the right answer for a large
   * build, and the wrong one for a van full of 12 V appliances, so it is
   * offered rather than chosen.
   */
  setSystemVoltage(voltage: SystemVoltage): void {
    this.voltage = voltage;
  }

  /** Builds a complete report from the current design. */
  report(): ElectricalReport {
    const battery = this.findBattery();
    const batteryCentre = battery ? battery.boundingBox().getCenter(new THREE.Vector3()) : null;

    const loads: LoadEntry[] = [];
    let batteryAmpHours = 0;
    let solarWatts = 0;
    let inverterWatts = 0;

    for (const object of this.store.all()) {
      batteryAmpHours += object.get('batteryAmpHours');
      solarWatts += object.get('solarWatts');
      inverterWatts += object.get('inverterWatts');

      const watts = object.get('loadWatts');
      if (watts <= 0) continue;

      const isAc = object.get('loadIsAc');
      const hours = object.get('loadHoursPerDay');
      const centre = object.boundingBox().getCenter(new THREE.Vector3());

      // AC loads are paid for twice: once for the energy, once for the
      // inverter's conversion loss.
      const batteryWatts = isAc ? watts / INVERTER_EFFICIENCY : watts;

      loads.push({
        name: object.name,
        kind: isAc ? 'ac' : 'dc',
        watts,
        hoursPerDay: hours,
        dailyWattHours: batteryWatts * hours,
        batteryAmps: batteryWatts / this.voltage,
        distanceFromBattery: batteryCentre ? centre.distanceTo(batteryCentre) : null,
      });
    }

    loads.sort((a, b) => b.dailyWattHours - a.dailyWattHours);

    const circuits = loads.map((load) => this.planCircuit(load));
    const budget = this.buildBudget(loads, batteryAmpHours, solarWatts, inverterWatts);

    return { loads, circuits, budget, hasBattery: battery !== null };
  }

  /**
   * Finds the battery the system is centred on.
   *
   * The largest bank wins when several are present, on the reasoning that
   * multiple batteries in a van are almost always paralleled in one place, and
   * the biggest one marks that place.
   */
  private findBattery(): SceneObject | null {
    let best: SceneObject | null = null;
    let bestCapacity = 0;

    for (const object of this.store.all()) {
      const capacity = object.get('batteryAmpHours');
      if (capacity > bestCapacity) {
        bestCapacity = capacity;
        best = object;
      }
    }

    return best;
  }

  /** Sizes the conductor for one load. */
  private planCircuit(load: LoadEntry): CircuitPlan {
    const runFeet =
      load.distanceFromBattery === null
        ? 0
        : (load.distanceFromBattery / 12) * ROUTING_FACTOR + SERVICE_SLACK_FEET;

    if (load.distanceFromBattery === null) {
      return {
        load,
        runFeet: 0,
        size: null,
        limitedBy: 'none',
        actualDrop: 0,
        fuseAmps: WireCalculator.fuseFor(load.batteryAmps),
        problem: 'No battery placed, so the run length is unknown.',
      };
    }

    const choice = WireCalculator.size(load.batteryAmps, runFeet, this.voltage);
    return {
      load,
      runFeet,
      size: choice.size,
      limitedBy: choice.limitedBy,
      actualDrop: choice.actualDrop,
      fuseAmps: choice.fuseAmps,
      problem: choice.problem,
    };
  }

  /** Assembles the energy balance and its warnings. */
  private buildBudget(
    loads: readonly LoadEntry[],
    batteryAmpHours: number,
    solarWatts: number,
    inverterWatts: number,
  ): PowerBudget {
    const dailyWattHours = loads.reduce((sum, load) => sum + load.dailyWattHours, 0);
    const usableWattHours = batteryAmpHours * this.voltage * USABLE_FRACTION;

    const solarSummer = solarWatts * SUN_HOURS.summer * SOLAR_DERATE;
    const solarWinter = solarWatts * SUN_HOURS.winter * SOLAR_DERATE;

    // Peak AC draw assumes everything AC could run at once. That is pessimistic
    // for a kettle and a microwave, which nobody runs together, but an inverter
    // sized for the pessimistic case is an inverter that never trips.
    const peakAcWatts = loads
      .filter((load) => load.kind === 'ac')
      .reduce((sum, load) => sum + load.watts, 0);

    const warnings: string[] = [];

    if (batteryAmpHours <= 0 && dailyWattHours > 0) {
      warnings.push('No battery in the design, so nothing here can be checked against capacity.');
    }

    if (usableWattHours > 0 && dailyWattHours > 0) {
      const days = usableWattHours / dailyWattHours;
      if (days < 1) {
        warnings.push(
          `The bank holds less than one day of use (${(days * 24).toFixed(0)} hours). Add capacity or cut consumption.`,
        );
      } else if (days < 2) {
        warnings.push(
          `Only ${days.toFixed(1)} days of reserve with no charging. Two to three days is a comfortable target.`,
        );
      }
    }

    if (solarWatts > 0 && dailyWattHours > 0 && solarWinter < dailyWattHours) {
      warnings.push(
        `Winter solar covers about ${Math.round((solarWinter / dailyWattHours) * 100)}% of daily use. Plan on alternator or shore charging in the colder months.`,
      );
    }

    if (solarWatts === 0 && dailyWattHours > 0) {
      warnings.push('No solar in the design. Charging will depend entirely on the alternator or shore power.');
    }

    if (peakAcWatts > 0 && inverterWatts > 0 && peakAcWatts > inverterWatts) {
      warnings.push(
        `AC loads total ${Math.round(peakAcWatts)} W but the inverter is rated ${Math.round(inverterWatts)} W. Either stagger their use or fit a larger inverter.`,
      );
    }

    if (peakAcWatts > 0 && inverterWatts === 0) {
      warnings.push('AC loads are present with no inverter placed.');
    }

    return {
      systemVoltage: this.voltage,
      dailyWattHours,
      batteryAmpHours,
      usableWattHours,
      daysOfAutonomy: dailyWattHours > 0 ? usableWattHours / dailyWattHours : 0,
      solarWatts,
      solarSummer,
      solarWinter,
      inverterWatts,
      peakAcWatts,
      warnings,
    };
  }
}
