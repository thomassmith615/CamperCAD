import {
  HAZEN_WILLIAMS_C,
  MAX_VELOCITY_FPS,
  PIPE_TABLE,
  QUIET_VELOCITY_FPS,
  type PipeSpec,
} from './PlumbingTypes';

/** Result of sizing one supply run. */
export interface PipeChoice {
  pipe: PipeSpec | null;
  velocityFps: number;
  pressureDropPsi: number;
  problem: string | null;
}

/**
 * Sizes water supply tubing.
 *
 * ## Why velocity rather than pressure drop decides it
 *
 * In a building, pipe sizing is a pressure-drop problem: water has to reach the
 * top floor. In a van every run is under twenty feet and level, so the pressure
 * lost to friction is a fraction of a psi and a 45 psi pump has ample margin.
 *
 * What actually goes wrong is **velocity**. Push 2 GPM through 3/8" tubing and
 * the water moves at nearly 7 ft/s, which hisses in the wall and hammers when a
 * tap shuts. In a vehicle where the plumbing runs a few feet from the bed, that
 * is the constraint people care about, so it is the one that drives the choice
 * here — with pressure drop reported alongside so the trade is visible.
 */
export class PipeCalculator {
  /**
   * Chooses tubing for a run.
   *
   * @param flowGpm Flow while the fixture is running.
   * @param runFeet One-way length of the run.
   */
  static size(flowGpm: number, runFeet: number): PipeChoice {
    if (flowGpm <= 0) {
      return { pipe: null, velocityFps: 0, pressureDropPsi: 0, problem: null };
    }

    // Prefer the smallest tubing that stays quiet; fall back to merely
    // acceptable before giving up, since 3/4" everywhere is wasteful and stiff
    // to route.
    const quiet = PIPE_TABLE.find((pipe) => PipeCalculator.velocity(flowGpm, pipe) <= QUIET_VELOCITY_FPS);
    const acceptable = PIPE_TABLE.find((pipe) => PipeCalculator.velocity(flowGpm, pipe) <= MAX_VELOCITY_FPS);
    const chosen = quiet ?? acceptable;

    if (!chosen) {
      const largest = PIPE_TABLE[PIPE_TABLE.length - 1];
      return {
        pipe: largest,
        velocityFps: PipeCalculator.velocity(flowGpm, largest),
        pressureDropPsi: PipeCalculator.pressureDrop(flowGpm, runFeet, largest),
        problem: `${flowGpm.toFixed(1)} GPM is too much for ${largest.label}. Split the supply or fit a lower-flow tap.`,
      };
    }

    const velocity = PipeCalculator.velocity(flowGpm, chosen);

    return {
      pipe: chosen,
      velocityFps: velocity,
      pressureDropPsi: PipeCalculator.pressureDrop(flowGpm, runFeet, chosen),
      problem:
        velocity > QUIET_VELOCITY_FPS
          ? `${velocity.toFixed(1)} ft/s in ${chosen.label} will be audible. Step up a size if the run passes near the bed.`
          : null,
    };
  }

  /**
   * Flow velocity in feet per second.
   *
   * Derived from `v = Q / A` with the units folded into the constant: one US
   * gallon per minute through one square inch is 0.4085 ft/s.
   */
  static velocity(flowGpm: number, pipe: PipeSpec): number {
    return (0.4085 * flowGpm) / (pipe.insideDiameter * pipe.insideDiameter);
  }

  /**
   * Pressure lost to friction over a run, in psi.
   *
   * Hazen-Williams, which is empirical and valid for water at ordinary
   * temperatures — exactly this case. The head loss it returns in feet is
   * converted at 0.433 psi per foot.
   *
   * Fittings are not counted individually. A van run has a handful of elbows,
   * each worth a foot or two of equivalent length, so the result is optimistic
   * by a psi or so. Given that the answer is compared against tens of psi of
   * pump pressure, that is immaterial — and pretending otherwise would imply a
   * precision the input flows do not have.
   */
  static pressureDrop(flowGpm: number, runFeet: number, pipe: PipeSpec): number {
    if (flowGpm <= 0 || runFeet <= 0) return 0;

    const headPerHundredFeet =
      0.2083 *
      (100 / HAZEN_WILLIAMS_C) ** 1.852 *
      (flowGpm ** 1.852 / pipe.insideDiameter ** 4.8655);

    return ((headPerHundredFeet * runFeet) / 100) * 0.433;
  }
}
