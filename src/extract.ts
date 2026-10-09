import { hexToLab, labToHex, rgbToLab, type Lab } from './color';
import { makeRng } from './generate';

/** Long side of the working bitmap: plenty to find a palette in, tiny to cluster. */
const WORK = 96;

/** Downsample an image on a 2D canvas and return its opaque pixels in OKLab. Nothing leaves the browser. */
export function samplePixels(img: CanvasImageSource, w: number, h: number): Lab[] {
  const k = Math.min(1, WORK / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return [];
  g.drawImage(img, 0, 0, cw, ch);
  const d = g.getImageData(0, 0, cw, ch).data;
  const out: Lab[] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    out.push(rgbToLab(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255));
  }
  return out;
}

const dist2 = (a: Lab, b: Lab): number => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

/**
 * k-means in OKLab (k-means++ seeding with a fixed seed, so one image always gives one palette), sorted dark → light.
 * An image with fewer than `k` distinct colours repeats some. Returns `#RRGGBB`.
 */
export function kmeansPalette(px: Lab[], k: number): string[] {
  if (px.length === 0 || k < 1) return [];
  const rng = makeRng(0x5eed);
  const cent: Lab[] = [[...px[Math.floor(rng() * px.length)]] as Lab];
  const near = new Float64Array(px.length).fill(Infinity);
  while (cent.length < k) {
    const last = cent[cent.length - 1];
    let total = 0;
    for (let i = 0; i < px.length; i++) {
      near[i] = Math.min(near[i], dist2(px[i], last));
      total += near[i];
    }
    if (!(total > 1e-9)) break; // every pixel already sits on a centre
    let t = rng() * total;
    let pick = px.length - 1;
    for (let i = 0; i < px.length; i++) {
      t -= near[i];
      if (t <= 0) {
        pick = i;
        break;
      }
    }
    cent.push([...px[pick]] as Lab);
  }
  for (let it = 0; it < 14; it++) {
    const sum = cent.map(() => [0, 0, 0, 0]);
    for (const p of px) {
      let b = 0;
      let bd = Infinity;
      for (let c = 0; c < cent.length; c++) {
        const d = dist2(p, cent[c]);
        if (d < bd) {
          bd = d;
          b = c;
        }
      }
      sum[b][0] += p[0];
      sum[b][1] += p[1];
      sum[b][2] += p[2];
      sum[b][3] += 1;
    }
    let moved = 0;
    sum.forEach((s, c) => {
      if (s[3] === 0) return;
      const n: Lab = [s[0] / s[3], s[1] / s[3], s[2] / s[3]];
      moved += dist2(n, cent[c]);
      cent[c] = n;
    });
    if (moved < 1e-8) break;
  }
  const cols = cent.map((c) => labToHex(c));
  for (let i = 0; cols.length < k; i++) cols.push(cols[i % cols.length]);
  return cols.sort((a, b) => hexToLab(a)[0] - hexToLab(b)[0]);
}

/** Decode an image file and extract `n` colours (dark → light). Rejects when the file is not a decodable image. */
export async function extractFromFile(file: File, n: number): Promise<string[]> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!(w > 0 && h > 0)) throw new Error('empty');
    return kmeansPalette(samplePixels(img, w, h), n);
  } finally {
    URL.revokeObjectURL(url);
  }
}
