import { FX_DEFAULT, type FxState } from './fx';
import type { Shape } from './store';

/** Optional per-node shape data (only CS-06 carries any). */
export interface ShapeExtra {
  shape?: Shape;
  rot?: number;
  pts?: [number, number][];
  /** Stroke path flags, only when set (see NodeState). */
  closed?: boolean;
  fill?: boolean;
  smooth?: boolean;
  /** Softness, only when it differs from the shape's default. */
  soft?: number;
  /** Opacity, only when below 100 %. */
  opac?: number;
  /** Per-node flags, only when set (see NodeState). */
  lock?: boolean;
  hide?: boolean;
}

export interface Preset {
  id: string;
  serial: string;
  name: string;
  colors: string[];
  /** Normalised stage coordinates, row by row (N-01 … N-09). */
  positions: [number, number][];
  /** Influence radii as a fraction of the short side. */
  radii: number[];
  shapes?: (ShapeExtra | undefined)[];
  /** FX saved with the set (CS-06 only). Switching to the preset applies them. */
  fx?: FxState;
}

export const PRESETS: Preset[] = [
  {
    id: 'cs01',
    serial: 'CS-01',
    name: 'NIGHT MARSH',
    colors: ['#0B1510', '#22401A', '#C0FE04', '#16301A', '#050807', '#4E7F22', '#C0FE04', '#0F1C14', '#E9EAE4'],
    positions: [
      [0.13, 0.15], [0.46, 0.1], [0.84, 0.22],
      [0.1, 0.46], [0.58, 0.5], [0.9, 0.6],
      [0.2, 0.8], [0.44, 0.9], [0.86, 0.86],
    ],
    radii: [0.42, 0.3, 0.3, 0.34, 0.46, 0.26, 0.24, 0.4, 0.2],
  },
  {
    id: 'cs02',
    serial: 'CS-02',
    name: 'FLARE DRILL',
    colors: ['#F24723', '#1C1C1C', '#F24723', '#E9EAE4', '#F24723', '#1C1C1C', '#000000', '#FFD400', '#F24723'],
    positions: [
      [0.16, 0.12], [0.52, 0.2], [0.88, 0.1],
      [0.08, 0.56], [0.46, 0.48], [0.9, 0.44],
      [0.18, 0.88], [0.56, 0.82], [0.84, 0.9],
    ],
    radii: [0.34, 0.36, 0.3, 0.3, 0.44, 0.34, 0.3, 0.26, 0.3],
  },
  {
    id: 'cs03',
    serial: 'CS-03',
    name: 'COOLANT LEAK',
    colors: ['#07141F', '#1FD7E3', '#000000', '#1FD7E3', '#0B2A3A', '#E9EAE4', '#000000', '#C0FE04', '#07141F'],
    positions: [
      [0.12, 0.18], [0.54, 0.1], [0.86, 0.16],
      [0.14, 0.52], [0.5, 0.56], [0.88, 0.46],
      [0.1, 0.86], [0.56, 0.86], [0.9, 0.84],
    ],
    radii: [0.36, 0.3, 0.38, 0.28, 0.42, 0.24, 0.34, 0.26, 0.3],
  },
  {
    id: 'cs04',
    serial: 'CS-04',
    name: 'UV SWEEP',
    colors: ['#5A2BFF', '#000000', '#E9EAE4', '#1C1C1C', '#5A2BFF', '#C0FE04', '#F24723', '#000000', '#5A2BFF'],
    positions: [
      [0.14, 0.1], [0.5, 0.16], [0.88, 0.12],
      [0.08, 0.48], [0.56, 0.44], [0.9, 0.54],
      [0.14, 0.88], [0.5, 0.84], [0.86, 0.9],
    ],
    radii: [0.4, 0.3, 0.3, 0.3, 0.46, 0.26, 0.3, 0.36, 0.34],
  },
  {
    id: 'cs05',
    serial: 'CS-05',
    name: 'PAPER TEST',
    colors: ['#E9EAE4', '#C0FE04', '#E9EAE4', '#717171', '#E9EAE4', '#F24723', '#E9EAE4', '#000000', '#E9EAE4'],
    positions: [
      [0.12, 0.14], [0.46, 0.1], [0.88, 0.16],
      [0.14, 0.5], [0.52, 0.52], [0.86, 0.46],
      [0.1, 0.86], [0.56, 0.88], [0.9, 0.86],
    ],
    radii: [0.4, 0.28, 0.36, 0.3, 0.4, 0.3, 0.36, 0.2, 0.38],
  },
  // ----- v6 sets (CS-21 … CS-25): shapes, strokes and softness variety. CS-06 … CS-13 are kept for the save library. -----
  {
    id: 'cs21',
    serial: 'CS-21',
    name: 'HULL BREACH',
    colors: ['#0A0A0A', '#1C1C1C', '#F24723', '#717171', '#E9EAE4', '#000000', '#F24723'],
    positions: [
      [0.12, 0.2], [0.46, 0.14], [0.6, 0.5], [0.2, 0.78], [0.86, 0.22], [0.84, 0.84], [0.38, 0.52],
    ],
    radii: [0.46, 0.34, 0.2, 0.4, 0.3, 0.36, 0.22],
    shapes: [
      undefined,
      { shape: 'box', rot: 0.26, soft: 0.3 },
      { shape: 'stroke', pts: [[-0.24, -0.1], [-0.1, 0.03], [0.02, -0.05], [0.14, 0.08], [0.26, 0.02]], soft: 0.62 },
      undefined,
      { shape: 'capsule', rot: 1.31, soft: 0.2 },
      { soft: 0.8 },
      { shape: 'ellipse', rot: 2.62, opac: 0.7 },
    ],
  },
  {
    id: 'cs22',
    serial: 'CS-22',
    name: 'AFTERBURN',
    colors: ['#07080C', '#FFD400', '#F24723', '#2B0A05', '#000000', '#F24723', '#E9EAE4', '#1C1C1C'],
    positions: [
      [0.1, 0.14], [0.34, 0.42], [0.58, 0.5], [0.84, 0.16], [0.14, 0.82], [0.7, 0.84], [0.44, 0.46], [0.9, 0.52],
    ],
    radii: [0.4, 0.3, 0.34, 0.36, 0.38, 0.3, 0.14, 0.3],
    shapes: [
      undefined,
      { shape: 'ellipse', rot: -0.52, soft: 0.45 },
      { shape: 'ellipse', rot: -0.52, soft: 0.6, opac: 0.85 },
      { soft: 0.9 },
      undefined,
      { shape: 'capsule', rot: -0.52, soft: 0.35 },
      { soft: 0.12 },
      { shape: 'box', rot: 0.4, opac: 0.6 },
    ],
    fx: { ...FX_DEFAULT, grain: 32, vig: 38 },
  },
  {
    id: 'cs23',
    serial: 'CS-23',
    name: 'ICE CORE',
    colors: ['#E9EAE4', '#1FD7E3', '#07141F', '#C9F3F6', '#0B2A3A', '#E9EAE4', '#1FD7E3', '#000000'],
    positions: [
      [0.14, 0.18], [0.5, 0.5], [0.86, 0.14], [0.3, 0.86], [0.1, 0.56], [0.74, 0.7], [0.58, 0.18], [0.92, 0.9],
    ],
    radii: [0.38, 0.28, 0.4, 0.3, 0.34, 0.26, 0.22, 0.36],
    shapes: [
      { soft: 0.85 },
      { shape: 'box', rot: 0.52, soft: 0.25 },
      undefined,
      { shape: 'capsule', rot: 0, soft: 0.5 },
      { opac: 0.8 },
      { shape: 'stroke', pts: [[-0.16, 0.08], [-0.05, -0.04], [0.06, 0.04], [0.18, -0.08]], soft: 0.7 },
      { shape: 'ellipse', rot: 1.05, soft: 0.35 },
      undefined,
    ],
  },
  {
    id: 'cs24',
    serial: 'CS-24',
    name: 'RELAY GHOST',
    colors: ['#1C1C1C', '#5A2BFF', '#000000', '#E9EAE4', '#5A2BFF', '#717171', '#C0FE04', '#0B0B14', '#1C1C1C'],
    positions: [
      [0.12, 0.12], [0.5, 0.2], [0.88, 0.1], [0.16, 0.5], [0.52, 0.52], [0.86, 0.5], [0.3, 0.9], [0.66, 0.84], [0.92, 0.92],
    ],
    radii: [0.4, 0.34, 0.3, 0.3, 0.42, 0.26, 0.3, 0.38, 0.3],
    shapes: [
      undefined,
      { shape: 'capsule', rot: 1.57, soft: 0.3 },
      { opac: 0.6 },
      { shape: 'box', rot: 0.78, soft: 0.15, opac: 0.9 },
      { soft: 0.9 },
      { shape: 'ellipse', rot: 0, soft: 0.4, opac: 0.5 },
      { shape: 'stroke', pts: [[-0.2, 0.02], [-0.08, -0.07], [0.04, 0.03], [0.17, -0.05], [0.28, 0.04]], soft: 0.45 },
      undefined,
      undefined,
    ],
    fx: { ...FX_DEFAULT, grain: 24, chroma: 22 },
  },
  {
    id: 'cs25',
    serial: 'CS-25',
    name: 'SALT FLAT',
    colors: ['#E9EAE4', '#DFE0D9', '#C0FE04', '#717171', '#F24723', '#E9EAE4', '#1C1C1C', '#FFFFFF'],
    positions: [
      [0.14, 0.2], [0.5, 0.16], [0.84, 0.3], [0.2, 0.62], [0.62, 0.62], [0.9, 0.84], [0.4, 0.9], [0.66, 0.26],
    ],
    radii: [0.42, 0.36, 0.3, 0.32, 0.3, 0.34, 0.3, 0.2],
    shapes: [
      { soft: 0.9 },
      { soft: 0.8 },
      { shape: 'capsule', rot: -0.35, soft: 0.3 },
      { shape: 'ellipse', rot: 0.35, soft: 0.5, opac: 0.75 },
      { shape: 'stroke', pts: [[-0.2, 0.06], [-0.06, -0.02], [0.08, 0.06], [0.22, -0.02]], soft: 0.55 },
      { opac: 0.8 },
      { shape: 'box', rot: 0, soft: 0.2 },
      { soft: 0.1 },
    ],
  },
];
