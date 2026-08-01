import type { VehicleDefinition } from '../VehicleTypes';

/**
 * Ram ProMaster 2500, 159" wheelbase, high roof, non-extended.
 *
 * Published figures are used wherever they exist. The interior cross-section is
 * the one part no manufacturer publishes, so it is reconstructed from the four
 * numbers that are known — floor width, maximum width and the height it occurs
 * at, and standing height — with the shoulder radius interpolated. It reads
 * correctly against the van and is accurate to roughly half an inch, which is
 * inside the tolerance of the trim panels a conversion actually attaches to.
 *
 * Replacing this with scanned or licensed CAD geometry means editing only the
 * numbers below: nothing else in the application knows a ProMaster from a
 * Sprinter.
 */
export const RAM_PROMASTER_2500_159_HIGH_ROOF: VehicleDefinition = {
  id: 'ram-promaster-2500-159-hr',
  name: 'Ram ProMaster 2500',
  variant: '159" WB · High Roof · Non-extended',
  modelYears: '2014–2024',

  // Right floor edge, up the passenger wall, across the roof, down to the left.
  sectionPoints: [
    [35.25, 0],
    [37.4, 14],
    [37.8, 26],
    [37.2, 42],
    [35.4, 56],
    [32.0, 65],
    [27.5, 70],
    [22.0, 74],
    [12.0, 76.0],
    [0, 76.4],
    [-12.0, 76.0],
    [-22.0, 74],
    [-27.5, 70],
    [-32.0, 65],
    [-35.4, 56],
    [-37.2, 42],
    [-37.8, 26],
    [-37.4, 14],
    [-35.25, 0],
  ],

  interior: {
    length: 149.9,
    floorWidth: 70.5,
    betweenWheelWells: 56,
  },

  floorThickness: 1.5,

  wheelWells: {
    length: 35,
    height: 17,
    protrusion: 7.25,
    centerZ: 45,
    cornerRadius: 4,
  },

  sideOpenings: [
    {
      id: 'sliding-door',
      label: 'Sliding door',
      side: 'right',
      bottomHeight: 0,
      topHeight: 65.5,
      zStart: -59.1,
      zEnd: -10.6,
    },
  ],

  rearOpening: {
    label: 'Rear doors',
    width: 61,
    height: 65.5,
    sillHeight: 0,
  },

  cabOpening: {
    label: 'Cab pass-through',
    width: 47,
    height: 54,
    sillHeight: 0,
  },

  weights: {
    gvwr: 9350,
    frontGawr: 4629,
    rearGawr: 5291,

    // Front-biased because the ProMaster is front-wheel drive: the engine,
    // transaxle and both seats sit ahead of or over the front axle.
    curbFront: 2950,
    curbRear: 2150,

    // Rear axle sits at the wheel-well centre, and the front axle one
    // wheelbase ahead of it — which places it inside the cab, as it should be
    // on a cab-forward van.
    frontAxleZ: -114,
    rearAxleZ: 45,

    sourceNotes: [
      'GVWR 9,350 lb, front GAWR 4,629 lb, rear GAWR 5,291 lb — Ram ProMaster fleet specifications.',
      'Curb weights are an estimate for a base cargo configuration and are split front/rear by the roughly 58/42 bias of a front-wheel-drive van. Real vans vary by several hundred pounds with options and fuel.',
      'Axle positions are derived from the 159" wheelbase and the wheel-well centre, not measured directly.',
      'Weigh your own van at a truck scale and enter the figures: every number here is a starting point, not a substitute.',
    ],
  },

  sourceNotes: [
    'Interior length 149.9", max width 75.6", roof height 76.4" — Ram published cargo specifications.',
    'Side door opening 48.5" wide, rear door opening 61" wide, wheel wells 35 × 17 × 9", 56" between wheel wells — Upfit Supply ProMaster 159" WB measurement guide.',
    'Sliding door position derived from the published 85.5" of usable passenger-side wall aft of the opening.',
    'Wheel well protrusion is derived as (floor width − clear width) ÷ 2 = 7.25" so the two published widths stay consistent.',
    'Door opening heights of 65.5" are approximate: published figures vary by roof and model year, and both openings narrow toward the shoulder radius.',
    'Cross-section curvature is an interpolated approximation, accurate to roughly ±0.5".',
  ],
};
