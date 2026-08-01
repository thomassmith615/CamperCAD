import * as THREE from 'three';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import { WATER_LB_PER_GALLON } from './WeightTypes';
import { PipeCalculator } from './PipeCalculator';
import {
  PLUMBING_ROUTING_FACTOR,
  PLUMBING_SLACK_FEET,
  type FixtureEntry,
  type PipeRun,
  type PlumbingReport,
  type TankRole,
  type WaterBudget,
} from './PlumbingTypes';

/**
 * Derives the water system from what is placed in the van.
 *
 * Like the electrical subsystem, fixtures are the objects already in the model
 * rather than a parallel list. A sink moved to the other end of the van gets a
 * longer supply run, and the report notices.
 *
 * The question this exists to answer is endurance. Capacity, consumption and
 * grey production together decide how long a van can stay somewhere, and that
 * single number drives more layout decisions than anything else in a
 * conversion — it is why people fit 40 gallon tanks that then wreck their axle
 * loading, which is a trade this application can now show both sides of.
 */
export class PlumbingService {
  private readonly store: ObjectStore;

  constructor(store: ObjectStore) {
    this.store = store;
  }

  /** Builds a complete report from the current design. */
  report(): PlumbingReport {
    const freshTank = this.findTank('fresh');
    const tankCentre = freshTank ? freshTank.boundingBox().getCenter(new THREE.Vector3()) : null;

    const fixtures: FixtureEntry[] = [];
    let freshGallons = 0;
    let greyGallons = 0;
    let blackGallons = 0;
    let pumpGpm = 0;

    for (const object of this.store.all()) {
      pumpGpm += object.get('pumpGpm');

      const role = object.get('tankRole') as TankRole;
      const capacity = object.get('capacityGallons');
      if (capacity > 0) {
        if (role === 'fresh') freshGallons += capacity;
        else if (role === 'grey') greyGallons += capacity;
        else if (role === 'black') blackGallons += capacity;
      }

      const flow = object.get('fixtureFlowGpm');
      if (flow <= 0) continue;

      const minutes = object.get('fixtureMinutesPerDay');
      const centre = object.boundingBox().getCenter(new THREE.Vector3());

      fixtures.push({
        name: object.name,
        flowGpm: flow,
        minutesPerDay: minutes,
        dailyGallons: flow * minutes,
        drainsToGrey: object.get('drainsToGrey'),
        distanceFromTank: tankCentre ? centre.distanceTo(tankCentre) : null,
      });
    }

    fixtures.sort((a, b) => b.dailyGallons - a.dailyGallons);

    const runs = fixtures.map((fixture) => PlumbingService.planRun(fixture));
    const budget = PlumbingService.buildBudget(fixtures, freshGallons, greyGallons, blackGallons, pumpGpm);

    return { fixtures, runs, budget, hasFreshTank: freshTank !== null };
  }

  /** Finds the largest tank in a given role. */
  private findTank(role: TankRole): SceneObject | null {
    let best: SceneObject | null = null;
    let bestCapacity = 0;

    for (const object of this.store.all()) {
      if (object.get('tankRole') !== role) continue;
      const capacity = object.get('capacityGallons');
      if (capacity > bestCapacity) {
        bestCapacity = capacity;
        best = object;
      }
    }

    return best;
  }

  /** Sizes the supply run for one fixture. */
  private static planRun(fixture: FixtureEntry): PipeRun {
    if (fixture.distanceFromTank === null) {
      return {
        fixture,
        runFeet: 0,
        pipe: null,
        velocityFps: 0,
        pressureDropPsi: 0,
        problem: 'No fresh tank placed, so the run length is unknown.',
      };
    }

    const runFeet =
      (fixture.distanceFromTank / 12) * PLUMBING_ROUTING_FACTOR + PLUMBING_SLACK_FEET;
    const choice = PipeCalculator.size(fixture.flowGpm, runFeet);

    return {
      fixture,
      runFeet,
      pipe: choice.pipe,
      velocityFps: choice.velocityFps,
      pressureDropPsi: choice.pressureDropPsi,
      problem: choice.problem,
    };
  }

  /** Assembles the water balance and its warnings. */
  private static buildBudget(
    fixtures: readonly FixtureEntry[],
    freshGallons: number,
    greyGallons: number,
    blackGallons: number,
    pumpGpm: number,
  ): WaterBudget {
    const dailyUse = fixtures.reduce((sum, fixture) => sum + fixture.dailyGallons, 0);
    const dailyGrey = fixtures
      .filter((fixture) => fixture.drainsToGrey)
      .reduce((sum, fixture) => sum + fixture.dailyGallons, 0);

    // Peak demand assumes the two thirstiest fixtures run together — a shower
    // while someone fills a kettle. Assuming everything at once would size the
    // pump for a scenario a two-berth van cannot physically produce.
    const flows = fixtures.map((fixture) => fixture.flowGpm).sort((a, b) => b - a);
    const peakDemandGpm = (flows[0] ?? 0) + (flows[1] ?? 0);

    const warnings: string[] = [];

    if (dailyUse > 0 && freshGallons === 0) {
      warnings.push('Fixtures are drawing water but there is no fresh tank in the design.');
    }

    const daysOfWater = dailyUse > 0 ? freshGallons / dailyUse : 0;
    const daysToGreyFull = dailyGrey > 0 ? greyGallons / dailyGrey : 0;

    if (daysOfWater > 0 && daysOfWater < 2) {
      warnings.push(
        `Fresh water lasts ${daysOfWater.toFixed(1)} days at this usage. Either carry more or cut back — a shower is usually the culprit.`,
      );
    }

    if (dailyGrey > 0 && greyGallons === 0) {
      warnings.push('Waste water has nowhere to go. Add a grey tank, or plan to drain outside every day.');
    } else if (daysToGreyFull > 0 && daysOfWater > 0 && daysToGreyFull < daysOfWater * 0.75) {
      warnings.push(
        `The grey tank fills in ${daysToGreyFull.toFixed(1)} days but fresh water lasts ${daysOfWater.toFixed(1)}. You will be dumping far more often than filling — size grey closer to fresh.`,
      );
    }

    if (dailyUse > 0 && pumpGpm === 0) {
      warnings.push('No water pump in the design.');
    } else if (pumpGpm > 0 && peakDemandGpm > pumpGpm) {
      warnings.push(
        `Two fixtures running together need ${peakDemandGpm.toFixed(1)} GPM but the pump delivers ${pumpGpm.toFixed(1)}. Pressure will drop when both are open.`,
      );
    }

    const freshWeightFull = freshGallons * WATER_LB_PER_GALLON;
    if (freshWeightFull > 250) {
      warnings.push(
        `A full fresh tank is ${Math.round(freshWeightFull)} lb. Check the weight panel — water is usually the heaviest single thing in a build.`,
      );
    }

    return {
      freshGallons,
      greyGallons,
      blackGallons,
      dailyUse,
      dailyGrey,
      daysOfWater,
      daysToGreyFull,
      peakDemandGpm,
      pumpGpm,
      freshWeightFull,
      warnings,
    };
  }
}
