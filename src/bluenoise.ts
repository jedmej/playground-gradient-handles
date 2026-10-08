/**
 * 64×64 blue-noise threshold map, void-and-cluster (Ulichney) with toroidal gaussian energy, σ = 1.5.
 * Fully deterministic (seeded), generated once and cached for every context, offscreen export included.
 * Each byte is the rank of its cell scaled to 0–255, so thresholding at any level gives an evenly spread mask.
 */
export const BLUE_SIZE = 64;

const N = BLUE_SIZE * BLUE_SIZE;
const SIGMA = 1.5;
const RADIUS = 6; // 4σ: past this the gaussian is < 0.0004

let cache: Uint8Array | null = null;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generate(): Uint8Array {
  const W = BLUE_SIZE;
  const span = RADIUS * 2 + 1;
  const kernel = new Float32Array(span * span);
  for (let y = -RADIUS; y <= RADIUS; y++) {
    for (let x = -RADIUS; x <= RADIUS; x++) {
      kernel[(y + RADIUS) * span + x + RADIUS] = Math.exp(-(x * x + y * y) / (2 * SIGMA * SIGMA));
    }
  }
  const energy = new Float32Array(N);
  const bits = new Uint8Array(N);

  /** Add (sign +1) or remove (−1) the gaussian of the pixel at `i`. */
  const splat = (i: number, sign: number): void => {
    const cx = i % W;
    const cy = (i / W) | 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      const row = ((cy + dy + W) % W) * W;
      const krow = (dy + RADIUS) * span + RADIUS;
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        energy[row + ((cx + dx + W) % W)] += sign * kernel[krow + dx];
      }
    }
  };
  const set = (i: number): void => {
    bits[i] = 1;
    splat(i, 1);
  };
  const clear = (i: number): void => {
    bits[i] = 0;
    splat(i, -1);
  };
  /** Tightest cluster: the set pixel with the most energy around it. */
  const tightest = (): number => {
    let best = -1;
    let e = -Infinity;
    for (let i = 0; i < N; i++) if (bits[i] === 1 && energy[i] > e) { e = energy[i]; best = i; }
    return best;
  };
  /** Largest void: the empty pixel with the least energy around it. */
  const largestVoid = (): number => {
    let best = -1;
    let e = Infinity;
    for (let i = 0; i < N; i++) if (bits[i] === 0 && energy[i] < e) { e = energy[i]; best = i; }
    return best;
  };

  // Initial pattern: ~10 % random ones, relaxed until the tightest cluster is also the largest void.
  const rnd = mulberry32(0x9e3779b1);
  const seedCount = Math.round(N * 0.1);
  for (let placed = 0; placed < seedCount; ) {
    const i = Math.floor(rnd() * N);
    if (bits[i] === 0) { set(i); placed++; }
  }
  for (let iter = 0; iter < 400; iter++) {
    const c = tightest();
    clear(c);
    const v = largestVoid();
    set(v);
    if (v === c) break;
  }

  const rank = new Uint16Array(N);
  const initial = Uint8Array.from(bits);

  // Phase 1: peel the initial ones off, tightest cluster first; the last survivor gets rank 0.
  for (let r = seedCount - 1; r >= 0; r--) {
    const c = tightest();
    rank[c] = r;
    clear(c);
  }
  // Phase 2 (and 3: the same rule, since the emptiest spot is also the tightest cluster of zeros):
  // restore the initial pattern and keep filling the largest void.
  energy.fill(0);
  bits.fill(0);
  for (let i = 0; i < N; i++) if (initial[i]) set(i);
  for (let r = seedCount; r < N; r++) {
    const v = largestVoid();
    rank[v] = r;
    set(v);
  }

  const out = new Uint8Array(N);
  for (let i = 0; i < N; i++) out[i] = Math.floor(((rank[i] + 0.5) * 256) / N);
  return out;
}

/** The cached threshold map (R channel values, 64×64 row-major). First call generates it. */
export function blueNoise(): Uint8Array {
  if (!cache) cache = generate();
  return cache;
}
