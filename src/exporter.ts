import { FieldBuffers, packField } from './field';
import { bumpStat } from './stats';
import { GradientRenderer } from './gradient';
import type { Dim, Store } from './store';

export type RenderResult =
  | { ok: true; blob: Blob }
  /** `limit`: the GPU cannot hold W×H (max = largest side it reports). `context`: WebGL would not allocate / was lost. */
  | { ok: false; reason: 'limit'; max: number }
  | { ok: false; reason: 'context' | 'failed' };

/**
 * Render the field (FX included) at W×H on a throwaway WebGL context and encode it as PNG.
 *
 * Reframe rule, "cover-fit, keep node positions relative": the field always fills the whole target and node
 * centres keep their relative positions (x·W, y·H). Every size-like quantity (radii, stroke offsets, the warp)
 * uses the area-matched unit u = stage.min · √(W·H / (stage.w·stage.h)); for a same-aspect target that is
 * exactly min(W, H), i.e. what the plain export always did.
 */
export async function renderOffscreen(
  store: Store,
  stage: Dim,
  W: number,
  H: number,
  seconds: number,
): Promise<RenderResult> {
  const canvas = document.createElement('canvas');
  let lost = false;
  canvas.addEventListener('webglcontextlost', () => (lost = true));
  let renderer: GradientRenderer | null = null;
  try {
    try {
      renderer = new GradientRenderer(canvas, { preserveDrawingBuffer: true });
    } catch {
      return { ok: false, reason: 'context' };
    }
    const gl = renderer.gl;
    const dims = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array | null;
    const max = Math.min(
      gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) as number,
      dims ? Math.min(dims[0], dims[1]) : Infinity,
    );
    if (!(max >= W && max >= H)) return { ok: false, reason: 'limit', max: Number.isFinite(max) ? max : 0 };

    const u = stage.min * Math.sqrt((W * H) / (stage.w * stage.h));
    renderer.resize(W, H, 1, u);
    if (gl.drawingBufferWidth !== W || gl.drawingBufferHeight !== H) {
      return { ok: false, reason: 'limit', max: Math.min(max, gl.drawingBufferWidth, gl.drawingBufferHeight) };
    }

    const buffers = new FieldBuffers();
    // Same packer as the live field (shapes and strokes included), but from settled targets.
    packField(store, { w: W, h: H, min: u }, buffers, true);
    // Grain / dither / scanline cells are authored in preview CSS px: u / stage.min export px per preview px.
    const fxOk = renderer.render({ ...buffers, time: seconds, grain: 0.05 }, store.fx, u / stage.min);
    if (lost || gl.isContextLost()) return { ok: false, reason: 'context' };
    // The FX framebuffer was not FRAMEBUFFER_COMPLETE at this size: treat it like any other size limit.
    if (!fxOk) return { ok: false, reason: 'limit', max };

    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
    if (lost || gl.isContextLost()) return { ok: false, reason: 'context' };
    return blob ? { ok: true, blob } : { ok: false, reason: 'failed' };
  } catch {
    return { ok: false, reason: lost ? 'context' : 'failed' };
  } finally {
    renderer?.dispose();
  }
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  bumpStat('exports');
}

export const stamp = (): string => {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
};

/** W×H for a render of the stage's aspect with `long` px on the long side (quick export, clipboard, thumbnails). */
export function quickSize(w: number, h: number, long = 2048): { w: number; h: number } {
  const aspect = w / h;
  return aspect >= 1 ? { w: long, h: Math.max(1, Math.round(long / aspect)) } : { w: Math.max(1, Math.round(long * aspect)), h: long };
}
