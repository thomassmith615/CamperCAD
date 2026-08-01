import * as THREE from 'three';
import type { ObjectStore } from '@/objects/ObjectStore';
import type { SceneObject } from '@/objects/SceneObject';
import type { VehicleModel } from '@/vehicle/VehicleModel';
import {
  CAUTION_THRESHOLD,
  LATERAL_WARNING_LB,
  WATER_LB_PER_GALLON,
  classifyLoad,
  type LoadCheck,
  type WeightReport,
} from './WeightTypes';

/**
 * Computes weight, balance and axle loads for the current design.
 *
 * ## The axle calculation
 *
 * A two-axle vehicle is a statically determinate beam. Taking moments about the
 * front axle, the load a mass contributes to the rear axle is its weight scaled
 * by how far behind the front axle it sits, divided by the wheelbase; the front
 * carries the remainder. Summing that over every object gives the build's
 * contribution, and the van's own curb distribution is added on top.
 *
 * This is exact for a static load, which is the case that matters: axle ratings
 * are static ratings, and a scale weighs a stationary van.
 *
 * ## What is deliberately not modelled
 *
 * Crew, fuel beyond its curb-weight contribution, gear, and dynamic load
 * transfer under braking or cornering. Each would need an assumption the user
 * has not made, and a number carrying a hidden assumption is worse than a
 * number the user knows to add to. The panel says so rather than silently
 * padding the figures.
 */
export class WeightService {
  private readonly store: ObjectStore;
  private vehicle: VehicleModel | null = null;

  /** User-supplied curb weights, overriding the published estimates. */
  private curbOverride: { front: number; rear: number } | null = null;

  constructor(store: ObjectStore) {
    this.store = store;
  }

  /** Points the service at the loaded vehicle, or at none. */
  setVehicle(vehicle: VehicleModel | null): void {
    this.vehicle = vehicle;
  }

  /** The current curb weight override, if the user set one. */
  get override(): { front: number; rear: number } | null {
    return this.curbOverride;
  }

  /**
   * Records measured curb weights from a scale ticket.
   *
   * Published curb weights are estimates for a base configuration, and a real
   * van differs by hundreds of pounds depending on options and how much fuel is
   * in it. Anyone doing this seriously weighs their van; the application should
   * use that number when they have it rather than insisting on the brochure.
   *
   * @param front Front axle weight in pounds, or null to clear the override.
   * @param rear Rear axle weight in pounds.
   */
  setMeasuredCurb(front: number | null, rear?: number): void {
    if (front === null || rear === undefined || front <= 0 || rear <= 0) {
      this.curbOverride = null;
      return;
    }
    this.curbOverride = { front, rear };
  }

  /**
   * The loaded weight of one object, including any fluid it holds.
   *
   * A 20 gallon tank is 12 lb of plastic and 167 lb of water. Keeping the two
   * separate in the catalog and combining them here is what lets the panel
   * report "empty" and "full" as different answers to the same layout.
   */
  static loadedWeight(object: SceneObject): number {
    return object.get('weight') + object.get('fillGallons') * WATER_LB_PER_GALLON;
  }

  /**
   * Builds a complete report.
   *
   * @returns Null when no vehicle is loaded, since every rating check is
   * defined relative to one.
   */
  report(): WeightReport | null {
    const vehicle = this.vehicle;
    if (!vehicle) return null;

    const spec = vehicle.definition.weights;
    const wheelbase = spec.rearAxleZ - spec.frontAxleZ;
    if (wheelbase <= 0) return null;

    let buildWeight = 0;
    let fluidWeight = 0;
    let momentX = 0;
    let momentY = 0;
    let momentZ = 0;
    let buildRear = 0;
    let passengerSide = 0;
    let driverSide = 0;

    for (const object of this.store.all()) {
      const weight = WeightService.loadedWeight(object);
      if (weight <= 0) continue;

      const { x, y, z } = object.boundingBox().getCenter(new THREE.Vector3());

      buildWeight += weight;
      fluidWeight += object.get('fillGallons') * WATER_LB_PER_GALLON;

      momentX += weight * x;
      momentY += weight * y;
      momentZ += weight * z;

      // Moment about the front axle, divided by wheelbase, is the share this
      // mass puts on the rear axle. Objects ahead of the front axle produce a
      // negative share, which correctly unloads the rear.
      buildRear += (weight * (z - spec.frontAxleZ)) / wheelbase;

      if (x >= 0) passengerSide += weight;
      else driverSide += weight;
    }

    const curbFront = this.curbOverride?.front ?? spec.curbFront;
    const curbRear = this.curbOverride?.rear ?? spec.curbRear;
    const curbWeight = curbFront + curbRear;

    const frontAxle = curbFront + (buildWeight - buildRear);
    const rearAxle = curbRear + buildRear;
    const grossWeight = curbWeight + buildWeight;

    const checks: LoadCheck[] = [
      WeightService.check('Gross weight', grossWeight, spec.gvwr),
      WeightService.check('Front axle', frontAxle, spec.frontGawr),
      WeightService.check('Rear axle', rearAxle, spec.rearGawr),
    ];

    return {
      buildWeight,
      fluidWeight,
      curbWeight,
      grossWeight,
      remainingPayload: spec.gvwr - grossWeight,
      frontAxle,
      rearAxle,
      buildCentre:
        buildWeight > 0
          ? { x: momentX / buildWeight, y: momentY / buildWeight, z: momentZ / buildWeight }
          : null,
      lateralImbalance: passengerSide - driverSide,
      checks,
      warnings: WeightService.buildWarnings(checks, passengerSide - driverSide),
    };
  }

  /** Builds one rating check. */
  private static check(label: string, actual: number, limit: number): LoadCheck {
    return {
      label,
      actual,
      limit,
      status: classifyLoad(actual, limit),
      utilisation: limit > 0 ? actual / limit : 0,
    };
  }

  /**
   * Turns checks into plain language, worst first.
   *
   * Wording is specific about the amount and the remedy, because "over GVWR" on
   * its own tells a builder nothing they can act on. Knowing they are 240 lb
   * over and that moving the water tank forward is the lever is what makes the
   * warning useful.
   */
  private static buildWarnings(checks: readonly LoadCheck[], lateral: number): string[] {
    const warnings: string[] = [];

    for (const check of checks) {
      if (check.status !== 'over') continue;
      const excess = Math.round(check.actual - check.limit);

      if (check.label === 'Gross weight') {
        warnings.push(
          `Over GVWR by ${excess} lb. This is a legal limit, not a guideline — remove weight rather than redistributing it.`,
        );
      } else if (check.label === 'Rear axle') {
        warnings.push(
          `Rear axle over its rating by ${excess} lb. Move heavy items — water, batteries — forward of the rear wheels.`,
        );
      } else {
        warnings.push(`Front axle over its rating by ${excess} lb. Move heavy items rearward.`);
      }
    }

    for (const check of checks) {
      if (check.status !== 'caution') continue;
      warnings.push(
        `${check.label} is at ${Math.round(check.utilisation * 100)}% of its rating. Leave room for crew, fuel and gear.`,
      );
    }

    if (Math.abs(lateral) >= LATERAL_WARNING_LB) {
      const side = lateral > 0 ? 'passenger' : 'driver';
      warnings.push(
        `${Math.round(Math.abs(lateral))} lb more on the ${side} side than the other. Consider balancing heavy items across the centreline.`,
      );
    }

    return warnings;
  }

  /** Utilisation at which the panel starts showing caution styling. */
  static get cautionThreshold(): number {
    return CAUTION_THRESHOLD;
  }
}
