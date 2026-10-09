import { fxNeedsPost, warpFreq, warpGain, WARP_HOUSE, type FxState } from './fx';
import { buildProgram, PostPass } from './post';

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_scale;
uniform int   u_count;
uniform vec2  u_pos[16];
uniform float u_rad[16];
uniform vec3  u_lab[16];
uniform float u_shape[16];   // 0 circle · 1 ellipse · 2 box · 3 capsule · 4 stroke
uniform float u_rot[16];
uniform float u_npts[16];
uniform float u_opac[16];    // node opacity 0–1: scales its pull on the field
uniform float u_soft[16];    // 0 crisp plateau · 0.5 gaussian · 1 wide haze
uniform sampler2D u_pts;     // 64 x 16 RGBA8: row i = stroke points of node i (16-bit x in RG, y in BA)
uniform vec2  u_css;         // canvas size in CSS px (the unit the points are packed against)
uniform float u_time;
uniform float u_grain;
uniform float u_min;
uniform float u_warp;
uniform float u_wscale;

vec3 oklabToLinear(vec3 c) {
  float l_ = c.x + 0.3963377774 * c.y + 0.2158037573 * c.z;
  float m_ = c.x - 0.1055613458 * c.y - 0.0638541728 * c.z;
  float s_ = c.x - 0.0894841775 * c.y - 1.2914855480 * c.z;
  float l = l_ * l_ * l_;
  float m = m_ * m_ * m_;
  float s = s_ * s_ * s_;
  return vec3(
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s);
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

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = rot * p * 2.03 + 7.3;
    a *= 0.5;
  }
  return v;
}

vec2 fetchPt(float row, float k) {
  vec4 c = texture2D(u_pts, vec2((k + 0.5) / 64.0, (row + 0.5) / 16.0)) * 255.0;
  vec2 u = vec2(c.r * 256.0 + c.g, c.b * 256.0 + c.a) / 65535.0;
  return (u * 2.0 - 0.5) * u_css;
}

float softP(float s) { return s < 0.5 ? mix(8.0, 2.0, s * 2.0) : mix(2.0, 1.15, (s - 0.5) * 2.0); }
float softTail(float s) { return s < 0.5 ? mix(0.004, 0.05, s * 2.0) : mix(0.05, 0.14, (s - 0.5) * 2.0); }
float coreW(float q, float s) { return exp(-1.5 * pow(max(q, 1e-4), softP(s))); }

void main() {
  vec2 p = gl_FragCoord.xy / u_scale;
  p.y = u_res.y / u_scale - p.y;

  // Low-frequency domain warp in short-side units so screen and export agree.
  vec2 n = p / u_min;
  float t = u_time * 0.035;
  vec2 q = vec2(
    fbm(n * u_wscale + vec2(t, 0.3 * t)),
    fbm(n * u_wscale + vec2(5.2, 1.3) - vec2(0.2 * t, t)));
  vec2 pw = p + (q - 0.44) * u_warp;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  float qs[16];
  for (int i = 0; i < 16; i++) {
    if (i >= u_count) break;
    float r = u_rad[i];
    float sh = u_shape[i];
    vec2 d0 = pw - u_pos[i];
    float qd;
    if (sh < 0.5) {
      qd = length(d0) / r;
    } else if (sh > 3.5) {
      vec2 prev = fetchPt(float(i), 0.0);
      float dm = length(pw - prev);
      for (int k = 1; k < 64; k++) {
        if (float(k) >= u_npts[i]) break;
        vec2 cur = fetchPt(float(i), float(k));
        vec2 ab = cur - prev;
        vec2 ap = pw - prev;
        float t = clamp(dot(ap, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
        dm = min(dm, length(ap - ab * t));
        prev = cur;
      }
      qd = dm / r;
    } else {
      float cs = cos(u_rot[i]);
      float sn = sin(u_rot[i]);
      vec2 l = vec2(cs * d0.x + sn * d0.y, -sn * d0.x + cs * d0.y);
      if (sh < 1.5) {
        qd = length(vec2(l.x, l.y / 0.45)) / r;
      } else if (sh < 2.5) {
        vec2 a = pow(max(abs(l), vec2(1e-4)), vec2(6.0));
        qd = pow(a.x + a.y, 1.0 / 6.0) / r;
      } else {
        qd = length(vec2(max(abs(l.x) - 0.6 * r, 0.0), l.y)) / (0.35 * r);
      }
    }
    qs[i] = qd;
    float q2 = qd * qd;
    float w = (coreW(qd, u_soft[i]) + softTail(u_soft[i]) / (1.0 + q2 * q2)) * u_opac[i];
    acc += u_lab[i] * w;
    wsum += w;
  }
  // Layers: the soft weighted average is the base; each core is then mixed over it, back (0) to front.
  vec3 col = acc / max(wsum, 1e-5);
  for (int i = 0; i < 16; i++) {
    if (i >= u_count) break;
    col = mix(col, u_lab[i], 0.85 * coreW(qs[i], u_soft[i]) * u_opac[i]);
  }
  vec3 rgb = linearToSrgb(oklabToLinear(col));

  float gt = floor(u_time * 24.0);
  float g1 = hash(gl_FragCoord.xy + vec2(gt * 7.13, gt * 3.71)) - 0.5;
  float g2 = hash(floor(gl_FragCoord.xy * 0.5) + vec2(gt * 1.3, 11.0)) - 0.5;
  rgb += g1 * u_grain + g2 * u_grain * 0.6;

  gl_FragColor = vec4(rgb, 1.0);
}
`;

export interface FieldParams {
  /** Node centres in CSS px of the canvas. */
  positions: Float32Array;
  /** Radii in CSS px. */
  radii: Float32Array;
  /** OKLab colours, 16 × 3. */
  lab: Float32Array;
  /** Shape ids (see SHAPE_ID), rotations (rad) and stroke point counts, 16 each. */
  shape: Float32Array;
  rot: Float32Array;
  npts: Float32Array;
  /** Softness 0–1, 16 entries. */
  soft: Float32Array;
  /** Opacity 0–1, 16 entries. */
  opac: Float32Array;
  /** Stroke point texture bytes, 64 × 16 RGBA8. Re-uploaded only when they change. */
  points: Uint8Array;
  /** Live node count (2–16); entries past it are ignored. */
  count: number;
  time: number;
  grain: number;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export class GradientRenderer {
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private cssW = 1;
  private cssH = 1;
  private scale = 1;
  private tex: WebGLTexture;
  private post: PostPass;
  /** Area-matched unit for radii and warp when it is not the short side (wallpaper reframing). */
  private minUnit: number | null = null;
  /** Last bytes uploaded to the point texture. */
  private uploaded = new Uint8Array(64 * 16 * 4);
  private texDirty = false;

  constructor(
    readonly canvas: HTMLCanvasElement,
    opts: { preserveDrawingBuffer?: boolean } = {},
  ) {
    const gl = canvas.getContext('webgl', {
      antialias: false,
      alpha: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: opts.preserveDrawingBuffer ?? false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    this.program = buildProgram(gl, VERT, FRAG);
    this.post = new PostPass(gl);
    gl.useProgram(this.program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); // a_pos is bound to location 0 in every program
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    for (const name of [
      'u_res', 'u_scale', 'u_count', 'u_pos', 'u_rad', 'u_lab', 'u_time', 'u_grain', 'u_min', 'u_warp', 'u_wscale',
      'u_shape', 'u_rot', 'u_npts', 'u_soft', 'u_opac', 'u_pts', 'u_css',
    ]) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }

    // Stroke points ride in a data texture: no float-texture extension, exact bytes (NEAREST, no mips).
    this.tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 64, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(64 * 16 * 4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(this.u.u_pts, 0);
  }

  /** Size the drawing buffer. `scale` maps CSS px → buffer px; `minUnit` overrides the short side for radii and warp. */
  resize(cssW: number, cssH: number, scale: number, minUnit?: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.scale = scale;
    this.minUnit = minUnit ?? null;
    const w = Math.round(this.cssW * scale);
    const h = Math.round(this.cssH * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  /**
   * Draw one frame. With no active `fx` the field goes straight to the canvas (no framebuffer); otherwise it is
   * rendered into an offscreen texture and the post pass resolves it. `fxUnit` = buffer px per preview CSS px
   * (default: the resize scale). Returns false when FX were asked for but could not run (plain field drawn).
   */
  render(p: FieldParams, fx?: FxState, fxUnit?: number): boolean {
    const gl = this.gl;
    const wantFx = !!fx && fxNeedsPost(fx);
    const useFx = wantFx && this.post.begin(this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_scale, this.scale);
    gl.uniform1i(this.u.u_count, p.count);
    gl.uniform2fv(this.u.u_pos, p.positions);
    gl.uniform1fv(this.u.u_rad, p.radii);
    gl.uniform3fv(this.u.u_lab, p.lab);
    gl.uniform1fv(this.u.u_shape, p.shape);
    gl.uniform1fv(this.u.u_rot, p.rot);
    gl.uniform1fv(this.u.u_npts, p.npts);
    gl.uniform1fv(this.u.u_soft, p.soft);
    gl.uniform1fv(this.u.u_opac, p.opac);
    gl.uniform2f(this.u.u_css, this.cssW, this.cssH);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (this.texDirty || !bytesEqual(this.uploaded, p.points)) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 64, 16, gl.RGBA, gl.UNSIGNED_BYTE, p.points);
      this.uploaded.set(p.points);
      this.texDirty = false;
    }
    gl.uniform1f(this.u.u_time, p.time);
    gl.uniform1f(this.u.u_grain, p.grain);
    const min = this.minUnit ?? Math.min(this.cssW, this.cssH);
    gl.uniform1f(this.u.u_min, min);
    // Warp gain: fbm deviation (~±0.35) × gain ≈ ±6 % of the short side at the house value; WARP in the FX panel moves it.
    gl.uniform1f(this.u.u_warp, min * (fx ? warpGain(fx) : WARP_HOUSE));
    gl.uniform1f(this.u.u_wscale, fx ? warpFreq(fx) : 1.7);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (useFx) this.post.draw(fx!, fxUnit ?? this.scale, p.lab, p.count);
    return !wantFx || useFx;
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
