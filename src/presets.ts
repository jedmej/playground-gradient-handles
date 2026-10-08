import type { Shape } from './store';

/** Optional per-node shape data (only CS-06 carries any). */
export interface ShapeExtra {
  shape?: Shape;
  rot?: number;
  pts?: [number, number][];
  /** Softness, only when it differs from the shape's default. */
  soft?: number;
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
];
