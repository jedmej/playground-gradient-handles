import { BLUE_SIZE, blueNoise } from './bluenoise';
import { hexToRgb, labToHex } from './color';
import type { FxState } from './fx';

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * One fullscreen pass, fixed order: pixel (resample grid) → chromatic aberration → glow → grade → map → halftone → ASCII →
 * vignette → scanlines → grain → dither. (WARP is not here: it bends the field in gradient.ts.)
 * Pattern coordinates are top-left origin buffer px; cell sizes are authored in preview CSS px and scaled by u_unit.
 */
const FRAG = `
precision highp float;
uniform sampler2D u_src;
uniform sampler2D u_blue;
uniform vec2  u_res;
uniform float u_unit;     // buffer px per preview CSS px
uniform float u_chroma;   // 0–1
uniform float u_vig;      // 0–1
uniform float u_scan;     // 0–1
uniform float u_scanDir;  // 0 = horizontal, 1 = vertical, 2 = both (grid)
uniform float u_grain;    // 0–1
uniform float u_coarse;   // 1 = coarse grain
uniform float u_levels;   // 0 = dither off, else 2–16
uniform float u_blueMode; // 1 = blue-noise thresholds, 0 = Bayer
uniform float u_pixel;    // 0–1 mosaic block size
uniform float u_glow;     // 0–1
uniform float u_grade;    // 0–1
uniform float u_gradeMode; // 0 punch, 1 warm, 2 cool, 3 fade
uniform float u_map;      // 0–1
uniform float u_mapMode;  // 0 posterize, 1 duo, 2 tri
uniform vec3  u_mapA;     // darkest node colour (sRGB)
uniform vec3  u_mapB;     // lightest
uniform vec3  u_mapC;     // middle (tri)
uniform vec2  u_mapRange; // luma of A and B
uniform float u_halftone; // 0–1
uniform float u_htCoarse; // 1 = coarse cells
uniform float u_ascii;    // 0–1
uniform float u_asCoarse; // 1 = coarse cells

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

float cellPx(float base) { return max(1.0, floor(base * u_unit + 0.5)); }

vec3 srgbToLinear(vec3 c) {
  vec3 lo = c / 12.92;
  vec3 hi = pow((c + 0.055) / 1.055, vec3(2.4));
  return mix(lo, hi, step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// GLSL ES 1.0 has no bit ops: the Bayer matrix from fract(), one octave per call.
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2.0 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }

// GRADE: one amount, four flavours. Works on sRGB, clamps to the gamut.
vec3 gradeFn(vec3 c) {
  if (u_grade <= 0.0) return c;
  c = clamp(c, 0.0, 1.0);
  float a = u_grade;
  float L = dot(c, LUMA);
  vec3 o = c;
  if (u_gradeMode < 0.5) {
    o = mix(c, c * c * (3.0 - 2.0 * c), 0.85 * a);
    o = vec3(dot(o, LUMA)) + (o - vec3(dot(o, LUMA))) * (1.0 + 0.6 * a);
  } else if (u_gradeMode < 1.5) {
    o = c * mix(vec3(1.0), vec3(1.1, 1.0, 0.8), a);
  } else if (u_gradeMode < 2.5) {
    o = c * mix(vec3(1.0), vec3(0.84, 0.98, 1.14), a);
  } else {
    o = mix(c, c * 0.84 + 0.13, a);
    o = mix(vec3(dot(o, LUMA)), o, 1.0 - 0.25 * a);
  }
  return clamp(o, 0.0, 1.0);
}

// MAP: posterize (amount = fewer levels) or a gradient map through the node colours (amount = blend).
vec3 mapFn(vec3 c) {
  if (u_map <= 0.0) return c;
  c = clamp(c, 0.0, 1.0);
  if (u_mapMode < 0.5) {
    float n = floor(mix(12.0, 2.0, u_map) + 0.5);
    return floor(c * (n - 1.0) + 0.5) / (n - 1.0);
  }
  float t = clamp((dot(c, LUMA) - u_mapRange.x) / max(u_mapRange.y - u_mapRange.x, 0.05), 0.0, 1.0);
  vec3 o = u_mapMode < 1.5 ? mix(u_mapA, u_mapB, t) : (t < 0.5 ? mix(u_mapA, u_mapC, t * 2.0) : mix(u_mapC, u_mapB, t * 2.0 - 1.0));
  return mix(c, o, u_map);
}

// One source tap at a top-left-origin buffer px position, graded and mapped like the rest of the image.
vec3 cellColor(vec2 posPx) {
  vec3 c = texture2D(u_src, vec2(posPx.x / u_res.x, 1.0 - posPx.y / u_res.y)).rgb;
  return mapFn(gradeFn(c));
}

float bar(vec2 p, vec2 hs, float aa) { return 1.0 - smoothstep(-aa, aa, max(abs(p.x) - hs.x, abs(p.y) - hs.y)); }
float dotg(vec2 p, vec2 c, float r, float aa) { return 1.0 - smoothstep(-aa, aa, length(p - c) - r); }

// Nine procedural glyph densities: blank . : - = + * # @ (g: x in cell widths, y in the same units, centred).
float glyph(float lv, vec2 g, float aa) {
  if (lv < 0.5) return 0.0;
  if (lv < 1.5) return dotg(g, vec2(0.0, 0.4), 0.1, aa);
  if (lv < 2.5) return max(dotg(g, vec2(0.0, -0.18), 0.1, aa), dotg(g, vec2(0.0, 0.32), 0.1, aa));
  if (lv < 3.5) return bar(g, vec2(0.3, 0.07), aa);
  if (lv < 4.5) return max(bar(g - vec2(0.0, 0.16), vec2(0.3, 0.065), aa), bar(g + vec2(0.0, 0.16), vec2(0.3, 0.065), aa));
  float plus = max(bar(g, vec2(0.3, 0.07), aa), bar(g, vec2(0.07, 0.4), aa));
  if (lv < 5.5) return plus;
  float ax = abs(g.x);
  float x = 1.0 - smoothstep(-aa, aa, max(abs(ax - abs(g.y) * 0.62) - 0.07, abs(g.y) - 0.42));
  if (lv < 6.5) return max(plus, x);
  if (lv < 7.5) {
    float v = bar(vec2(abs(g.x) - 0.16, g.y), vec2(0.065, 0.5), aa);
    float h = bar(vec2(g.x, abs(g.y) - 0.2), vec2(0.38, 0.065), aa);
    return max(v, h);
  }
  return bar(g, vec2(0.34, 0.55), aa);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;
  vec2 pos = vec2(frag.x, u_res.y - frag.y);

  // Aspect-correct frame coordinates: short side = 1, d at the corner = dc.
  vec2 asp = u_res / min(u_res.x, u_res.y);
  vec2 d = (uv - 0.5) * asp;
  vec2 dc = 0.5 * asp;

  // PIXEL: every tap below reads the block centre, so chroma and glow see the mosaic too.
  vec2 suv = uv;
  if (u_pixel > 0.0) {
    float blk = cellPx(2.0 + 38.0 * u_pixel);
    vec2 bc = (floor(pos / blk) + 0.5) * blk;
    suv = vec2(bc.x / u_res.x, 1.0 - bc.y / u_res.y);
  }

  vec3 rgb;
  if (u_chroma > 0.0) {
    vec2 o = d * (u_chroma * 0.07 * dot(d, d) / dot(dc, dc));
    vec2 ou = o / asp;
    float r = (texture2D(u_src, suv + 0.33 * ou).r + texture2D(u_src, suv + 0.66 * ou).r + texture2D(u_src, suv + ou).r) / 3.0;
    float g = texture2D(u_src, suv).g;
    float b = (texture2D(u_src, suv - 0.33 * ou).b + texture2D(u_src, suv - 0.66 * ou).b + texture2D(u_src, suv - ou).b) / 3.0;
    rgb = vec3(r, g, b);
  } else {
    rgb = texture2D(u_src, suv).rgb;
  }

  if (u_glow > 0.0) {
    // Bloom: a golden-angle spiral of 24 taps over a radius that grows with the amount, bright-passed, screened back on.
    float rad = (10.0 + 30.0 * u_glow) * u_unit;
    vec3 acc = vec3(0.0);
    float ws = 0.0;
    for (int i = 0; i < 24; i++) {
      float fi = float(i);
      float ang = fi * 2.39996323;
      float rr = sqrt((fi + 0.5) / 24.0);
      vec3 s = texture2D(u_src, suv + vec2(cos(ang), sin(ang)) * (rr * rad) / u_res).rgb;
      float w = 1.0 - 0.5 * rr;
      acc += s * smoothstep(0.45, 0.95, dot(s, LUMA)) * w;
      ws += w;
    }
    rgb = 1.0 - (1.0 - clamp(rgb, 0.0, 1.0)) * (1.0 - clamp(acc / ws * u_glow * 1.4, 0.0, 1.0));
  }

  rgb = mapFn(gradeFn(rgb));

  if (u_halftone > 0.0) {
    // 45° dot screen: one source tap per cell (graded + mapped), dot area follows luma, full-colour dots on a near-black sheet.
    float cell = max(2.0, (u_htCoarse > 0.5 ? 9.0 : 5.0) * u_unit);
    float cs = 0.70710678;
    vec2 rp = vec2(cs * pos.x + cs * pos.y, -cs * pos.x + cs * pos.y) / cell;
    vec2 id = floor(rp);
    vec2 f = fract(rp) - 0.5;
    vec2 cq = (id + 0.5) * cell;
    vec3 cc = cellColor(vec2(cs * cq.x - cs * cq.y, cs * cq.x + cs * cq.y));
    float L = dot(cc, LUMA);
    float aa = 0.75 / cell;
    float m = 1.0 - smoothstep(-aa, aa, length(f) - 0.71 * sqrt(L));
    vec3 dotc = clamp(cc / max(L, 0.25), 0.0, 1.0);
    rgb = mix(rgb, mix(cc * 0.07, dotc, m), u_halftone);
  }

  if (u_ascii > 0.0) {
    // Character cells (1 : 1.7): luma picks one of nine procedural glyphs, drawn in the cell's colour on a dark ground.
    float cw = max(3.0, floor((u_asCoarse > 0.5 ? 10.0 : 6.0) * u_unit + 0.5));
    vec2 csz = vec2(cw, floor(cw * 1.7 + 0.5));
    vec2 cid = floor(pos / csz);
    vec3 cc = cellColor((cid + 0.5) * csz);
    vec2 lp = (pos / csz - cid - 0.5) * vec2(1.0, csz.y / csz.x);
    float lv = floor(clamp(dot(cc, LUMA), 0.0, 1.0) * 8.999);
    float m = glyph(lv, lp, 0.8 / cw);
    rgb = mix(rgb, mix(cc * 0.07, clamp(cc * 1.25 + 0.04, 0.0, 1.0), m), u_ascii);
  }

  if (u_vig > 0.0) {
    float v = length(d) / length(dc);
    vec3 lin = srgbToLinear(rgb);
    lin *= 1.0 - u_vig * 0.82 * smoothstep(0.28, 1.08, v);
    rgb = linearToSrgb(lin);
  }

  if (u_scan > 0.0) {
    float period = cellPx(3.0);
    // Lines run along x (horizontal) from pos.y, along y (vertical) from pos.x; both = max, so the grid never darkens more than one set.
    float sh = 0.5 - 0.5 * cos(6.28318530718 * fract(pos.y / period));
    float sv = 0.5 - 0.5 * cos(6.28318530718 * fract(pos.x / period));
    float s = u_scanDir > 1.5 ? max(sh, sv) : u_scanDir > 0.5 ? sv : sh;
    rgb *= 1.0 - u_scan * 0.5 * s * s;
  }

  if (u_grain > 0.0) {
    float n;
    if (u_coarse > 0.5) {
      vec2 p = pos / cellPx(2.5);
      n = 0.62 * vnoise(p + 17.0) + 0.38 * vnoise(p * 2.07 + 31.7);
      n = (n - 0.5) * 1.7 + 0.5;
    } else {
      n = hash(floor(pos / cellPx(1.0)) + vec2(17.0, 39.1));
    }
    float L = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
    rgb += (n - 0.5) * u_grain * 0.20 * (0.35 + 2.6 * L * (1.0 - L));
  }

  if (u_levels > 1.5) {
    float t;
    if (u_blueMode > 0.5) {
      vec2 a = mod(floor(pos / cellPx(1.0)), ${BLUE_SIZE}.0);
      t = texture2D(u_blue, (a + 0.5) / ${BLUE_SIZE}.0).r * (255.0 / 256.0) + 0.5 / 256.0;
    } else {
      vec2 a = mod(floor(pos / cellPx(2.0)), 8.0);
      t = bayer8(a) + 0.5 / 64.0;
    }
    float steps = u_levels - 1.0;
    rgb = floor(clamp(rgb, 0.0, 1.0) * steps + t) / steps;
  }

  gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
}
`;

export function buildProgram(gl: WebGLRenderingContext, vs: string, fs: string): WebGLProgram {
  const compile = (type: number, src: string): WebGLShader => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
    return sh;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.bindAttribLocation(p, 0, 'a_pos'); // every program shares the one fullscreen-triangle buffer
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
  return p;
}

const lumaOf = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/** MAP colours: the darkest, lightest and median-luma node colours (sRGB 0–1) with the luma of the two ends. */
function mapColours(lab: Float32Array, count: number): { a: number[]; b: number[]; c: number[]; la: number; lb: number } {
  const cols: number[][] = [];
  for (let i = 0; i < Math.max(1, count); i++) cols.push(hexToRgb(labToHex([lab[i * 3], lab[i * 3 + 1], lab[i * 3 + 2]])));
  cols.sort((p, q) => lumaOf(p) - lumaOf(q));
  const a = cols[0];
  const b = cols[cols.length - 1];
  const c = cols.length >= 3 ? cols[Math.floor(cols.length / 2)] : a.map((v, k) => (v + b[k]) / 2);
  return { a, b, c, la: lumaOf(a), lb: lumaOf(b) };
}

/** Texture units used here; unit 0 belongs to the field's stroke-point texture. */
const UNIT_SRC = 2;
const UNIT_BLUE = 3;

/** Render target + post shader for one GL context. Everything is allocated lazily, on first use of FX. */
export class PostPass {
  private prog: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private fbo: WebGLFramebuffer | null = null;
  private tex: WebGLTexture | null = null;
  private blueTex: WebGLTexture | null = null;
  private w = 0;
  private h = 0;
  /** Set once the pass could not be built or the framebuffer was incomplete: callers fall back to the direct path. */
  broken = false;

  constructor(private gl: WebGLRenderingContext) {}

  /** Bind the offscreen target at `w × h`, allocating it if needed. False when FX cannot run here. */
  begin(w: number, h: number): boolean {
    if (this.broken) return false;
    const gl = this.gl;
    try {
      if (!this.prog) {
        this.prog = buildProgram(gl, VERT, FRAG);
        for (const n of ['u_src', 'u_blue', 'u_res', 'u_unit', 'u_chroma', 'u_vig', 'u_scan', 'u_scanDir', 'u_grain', 'u_coarse', 'u_levels', 'u_blueMode',
          'u_pixel', 'u_glow', 'u_grade', 'u_gradeMode', 'u_map', 'u_mapMode', 'u_mapA', 'u_mapB', 'u_mapC', 'u_mapRange',
          'u_halftone', 'u_htCoarse', 'u_ascii', 'u_asCoarse']) {
          this.u[n] = gl.getUniformLocation(this.prog, n);
        }
      }
    } catch {
      this.broken = true;
      return false;
    }
    if (!this.fbo || this.w !== w || this.h !== h) {
      if (!this.fbo) this.fbo = gl.createFramebuffer();
      if (!this.tex) this.tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE0 + UNIT_SRC);
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.tex, 0);
      this.w = w;
      this.h = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.broken = true;
      return false;
    }
    return true;
  }

  private uploadBlue(): void {
    const gl = this.gl;
    const src = blueNoise();
    const rgba = new Uint8Array(src.length * 4);
    for (let i = 0; i < src.length; i++) {
      rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = src[i];
      rgba[i * 4 + 3] = 255;
    }
    this.blueTex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + UNIT_BLUE);
    gl.bindTexture(gl.TEXTURE_2D, this.blueTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, BLUE_SIZE, BLUE_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.activeTexture(gl.TEXTURE0);
  }

  /**
   * Resolve the offscreen field to the default framebuffer through the post shader. `lab` / `count` are the live
   * nodes' OKLab colours (16 × 3): MAP's duo / tritone is built from the darkest, lightest and middle node by luma.
   */
  draw(fx: FxState, unit: number, lab: Float32Array, count: number): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(this.prog);
    const blue = fx.dither > 0 && fx.ditherMode === 'blue';
    if (blue && !this.blueTex) this.uploadBlue();
    gl.activeTexture(gl.TEXTURE0 + UNIT_SRC);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.blueTex) {
      gl.activeTexture(gl.TEXTURE0 + UNIT_BLUE);
      gl.bindTexture(gl.TEXTURE_2D, this.blueTex);
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u.u_src, UNIT_SRC);
    gl.uniform1i(this.u.u_blue, UNIT_BLUE);
    gl.uniform2f(this.u.u_res, this.w, this.h);
    gl.uniform1f(this.u.u_unit, unit);
    gl.uniform1f(this.u.u_chroma, fx.chroma / 100);
    gl.uniform1f(this.u.u_vig, fx.vig / 100);
    gl.uniform1f(this.u.u_scan, fx.scan / 100);
    gl.uniform1f(this.u.u_scanDir, fx.scanDir === 'v' ? 1 : fx.scanDir === 'b' ? 2 : 0);
    gl.uniform1f(this.u.u_grain, fx.grain / 100);
    gl.uniform1f(this.u.u_coarse, fx.grainSize === 'coarse' ? 1 : 0);
    gl.uniform1f(this.u.u_levels, fx.dither);
    gl.uniform1f(this.u.u_blueMode, blue ? 1 : 0);
    gl.uniform1f(this.u.u_pixel, fx.pixel / 100);
    gl.uniform1f(this.u.u_glow, fx.glow / 100);
    gl.uniform1f(this.u.u_grade, fx.grade / 100);
    gl.uniform1f(this.u.u_gradeMode, ['punch', 'warm', 'cool', 'fade'].indexOf(fx.gradeMode));
    gl.uniform1f(this.u.u_map, fx.map / 100);
    gl.uniform1f(this.u.u_mapMode, fx.mapMode === 'duo' ? 1 : fx.mapMode === 'tri' ? 2 : 0);
    if (fx.map > 0 && fx.mapMode !== 'post') {
      const m = mapColours(lab, count);
      gl.uniform3fv(this.u.u_mapA, m.a);
      gl.uniform3fv(this.u.u_mapB, m.b);
      gl.uniform3fv(this.u.u_mapC, m.c);
      gl.uniform2f(this.u.u_mapRange, m.la, m.lb);
    }
    gl.uniform1f(this.u.u_halftone, fx.halftone / 100);
    gl.uniform1f(this.u.u_htCoarse, fx.halftoneSize === 'coarse' ? 1 : 0);
    gl.uniform1f(this.u.u_ascii, fx.ascii / 100);
    gl.uniform1f(this.u.u_asCoarse, fx.asciiSize === 'coarse' ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
