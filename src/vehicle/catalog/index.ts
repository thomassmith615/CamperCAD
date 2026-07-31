import type { VehicleDefinition } from '../VehicleTypes';
import { RAM_PROMASTER_2500_159_HIGH_ROOF } from './ramProMaster2500_159_HighRoof';

/**
 * Every vehicle the application can build, keyed by definition id.
 *
 * Saved projects store a vehicle **id**, not a copy of its geometry. That keeps
 * project files small and means a correction to the ProMaster's measurements
 * reaches every existing project rather than only new ones. The cost is that an
 * id can never be reused or renamed, which is why {@link VehicleDefinition.id}
 * is documented as permanent.
 */
const CATALOG: readonly VehicleDefinition[] = [RAM_PROMASTER_2500_159_HIGH_ROOF];

/** The vehicle a new project starts with. */
export const DEFAULT_VEHICLE = RAM_PROMASTER_2500_159_HIGH_ROOF;

/** Every available vehicle, in menu order. */
export function allVehicles(): readonly VehicleDefinition[] {
  return CATALOG;
}

/**
 * Looks up a vehicle by id.
 *
 * @returns The definition, or undefined when a project references a vehicle
 * this build does not know about — which is what happens when a project is
 * opened in an older release than it was created in.
 */
export function findVehicle(id: string): VehicleDefinition | undefined {
  return CATALOG.find((vehicle) => vehicle.id === id);
}
