/**
 * Named lighting and environment setups.
 *
 * The default workshop rig exists to make geometry legible: even, neutral, no
 * drama. That is right for modelling and wrong for deciding whether you want to
 * live in the result. These presets exist for the second question — what a
 * layout feels like at dusk with the interior lights on tells you something
 * about it that an even white light never will.
 *
 * Every value here is a rendering choice with no effect on measurements,
 * weights or any other calculation. That separation is deliberate: nothing in
 * this file can change an answer the application gives.
 */

/** Identifier for a render preset. */
export type RenderPresetId =
  | 'workshop'
  | 'daylight'
  | 'golden'
  | 'overcast'
  | 'dusk'
  | 'interior'
  | 'blueprint';

/** A complete lighting and tone configuration. */
export interface RenderPreset {
  id: RenderPresetId;
  label: string;
  /** One line describing what this is for. */
  description: string;

  /** Scene background and fog colour. */
  background: number;
  /** Fog start and end distances in inches, or null to disable fog. */
  fog: [number, number] | null;

  /** Sky and ground colours for the hemisphere fill, and its intensity. */
  hemisphereSky: number;
  hemisphereGround: number;
  hemisphereIntensity: number;

  /** Key light colour and intensity. */
  keyColor: number;
  keyIntensity: number;
  /** Key direction as a normalised-ish vector; the rig scales it to the scene. */
  keyDirection: [number, number, number];

  /** Rim light colour and intensity. */
  rimColor: number;
  rimIntensity: number;

  /** Overhead fill, standing in for ceiling lights. */
  fillColor: number;
  fillIntensity: number;

  /** Tone mapping exposure. */
  exposure: number;
  /** Whether the key light casts shadows. */
  shadows: boolean;

  /**
   * Whether to draw the sky dome and ground.
   *
   * Outdoor presets also hide the construction grid, because a grid floating
   * over a lawn is the single thing that most breaks the illusion — and if you
   * are looking at an outdoor view you have stopped measuring anyway.
   */
  outdoor: boolean;
  /** Sky gradient, zenith to horizon. Ignored when `outdoor` is false. */
  skyTop: number;
  skyHorizon: number;
  /** Colour of the ground the van is parked on. */
  groundColor: number;
}

/**
 * The presets.
 *
 * `blueprint` is the odd one out and earns its place: flat, shadowless and
 * cool, it is what you switch to when you have stopped admiring the render and
 * gone back to checking whether two things collide.
 */
export const RENDER_PRESETS: readonly RenderPreset[] = [
  {
    id: 'workshop',
    label: 'Workshop',
    description: 'Even neutral light for modelling. The default.',
    background: 0x14171c,
    fog: [900, 2600],
    hemisphereSky: 0xbcd2e8,
    hemisphereGround: 0x2a2620,
    hemisphereIntensity: 0.85,
    keyColor: 0xfff2e0,
    keyIntensity: 2.1,
    keyDirection: [-0.5, 0.85, -0.7],
    rimColor: 0x9fc4e8,
    rimIntensity: 0.9,
    fillColor: 0xffffff,
    fillIntensity: 0.45,
    exposure: 1.05,
    shadows: true,
    outdoor: false,
    skyTop: 0x3f7fc4,
    skyHorizon: 0xc9d8e6,
    groundColor: 0x6f7a52,
  },
  {
    id: 'daylight',
    label: 'Daylight (outside)',
    description: 'Parked in the open at midday. No grid, real sky and ground.',
    background: 0x9fc0dd,
    fog: [2400, 6000],
    hemisphereSky: 0xdceaf7,
    hemisphereGround: 0x6b6558,
    hemisphereIntensity: 1.5,
    keyColor: 0xfffaf0,
    keyIntensity: 3.2,
    keyDirection: [-0.3, 1.1, -0.4],
    rimColor: 0xbcd8f5,
    rimIntensity: 0.7,
    fillColor: 0xffffff,
    fillIntensity: 0.3,
    exposure: 1.0,
    shadows: true,
    outdoor: true,
    skyTop: 0x3d78bd,
    skyHorizon: 0xd3e2ee,
    groundColor: 0x74805a,
  },
  {
    id: 'golden',
    label: 'Golden hour (outside)',
    description: 'Low warm sun through the side door, an hour before sunset.',
    background: 0xd9a271,
    fog: [1800, 5200],
    hemisphereSky: 0xf0c9a0,
    hemisphereGround: 0x3a2418,
    hemisphereIntensity: 0.9,
    keyColor: 0xffb066,
    keyIntensity: 3.6,
    keyDirection: [1.0, 0.22, 0.35],
    rimColor: 0x6f8fc0,
    rimIntensity: 0.8,
    fillColor: 0xffd9b0,
    fillIntensity: 0.22,
    exposure: 1.12,
    shadows: true,
    outdoor: true,
    skyTop: 0x2f5b8f,
    skyHorizon: 0xf0a463,
    groundColor: 0x8a7449,
  },
  {
    id: 'overcast',
    label: 'Overcast (outside)',
    description: 'Flat grey sky. Soft, shadowless, and the truest colours you will get.',
    background: 0xb8bfc6,
    fog: [2200, 6000],
    hemisphereSky: 0xdde3e9,
    hemisphereGround: 0x7d8378,
    hemisphereIntensity: 2.6,
    keyColor: 0xf2f5f8,
    keyIntensity: 0.7,
    keyDirection: [-0.2, 1, -0.2],
    rimColor: 0xd6dee6,
    rimIntensity: 0.5,
    fillColor: 0xffffff,
    fillIntensity: 0.5,
    exposure: 1.0,
    shadows: false,
    outdoor: true,
    skyTop: 0x9aa4ad,
    skyHorizon: 0xcfd6dc,
    groundColor: 0x6d7466,
  },
  {
    id: 'dusk',
    label: 'Dusk (outside)',
    description: 'Blue hour outside with the interior lights already on.',
    background: 0x1e2740,
    fog: [900, 3200],
    hemisphereSky: 0x37476e,
    hemisphereGround: 0x14161c,
    hemisphereIntensity: 0.6,
    keyColor: 0x8fa8d8,
    keyIntensity: 0.6,
    keyDirection: [-0.8, 0.5, 0.4],
    rimColor: 0x5d76ad,
    rimIntensity: 0.6,
    fillColor: 0xffc98a,
    fillIntensity: 1.9,
    exposure: 1.2,
    shadows: true,
    outdoor: true,
    skyTop: 0x121c33,
    skyHorizon: 0x5a5f7d,
    groundColor: 0x2f3630,
  },
  {
    id: 'interior',
    label: 'Night interior',
    description: 'Dark outside, warm ceiling lights on. Shows how it feels to be in it.',
    background: 0x0b0d11,
    fog: [400, 1400],
    hemisphereSky: 0x3a4256,
    hemisphereGround: 0x100c08,
    hemisphereIntensity: 0.28,
    keyColor: 0xffd9a8,
    keyIntensity: 0.5,
    keyDirection: [-0.4, 0.9, -0.2],
    rimColor: 0x4a5f8a,
    rimIntensity: 0.35,
    fillColor: 0xffc98a,
    fillIntensity: 2.4,
    exposure: 1.25,
    shadows: true,
    outdoor: false,
    skyTop: 0x101520,
    skyHorizon: 0x1c2430,
    groundColor: 0x1a1c1e,
  },
  {
    id: 'blueprint',
    label: 'Blueprint',
    description: 'Flat and shadowless. For checking geometry rather than admiring it.',
    background: 0x121820,
    fog: null,
    hemisphereSky: 0xdfe9f5,
    hemisphereGround: 0xa8b6c4,
    hemisphereIntensity: 2.4,
    keyColor: 0xffffff,
    keyIntensity: 0.5,
    keyDirection: [-0.3, 1, -0.3],
    rimColor: 0xffffff,
    rimIntensity: 0.4,
    fillColor: 0xffffff,
    fillIntensity: 0.6,
    exposure: 1.0,
    shadows: false,
    outdoor: false,
    skyTop: 0xdfe9f5,
    skyHorizon: 0xdfe9f5,
    groundColor: 0x9aa4ad,
  },
];

/** Looks up a preset, falling back to the workshop default. */
export function findPreset(id: string): RenderPreset {
  return RENDER_PRESETS.find((preset) => preset.id === id) ?? RENDER_PRESETS[0];
}
