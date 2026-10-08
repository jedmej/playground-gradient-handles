import { BLUE_SIZE, blueNoise } from './bluenoise';
import type { FxState } from './fx';

const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

/**
 * One fullscreen pass, fixed order: chromatic aberration → vignette → scanlines → grain → dither.
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
uniform float u_grain;    // 0–1
uniform float u_coarse;   // 1 = coarse grain
uniform float u_levels;   // 0 = dither off, else 2–16
uniform float u_blueMode; // 1 = blue-noise thresholds, 0 = Bayer

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

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = frag / u_res;
  vec2 pos = vec2(frag.x, u_res.y - frag.y);

  // Aspect-correct frame coordinates: short side = 1, d at the corner = dc.
  vec2 asp = u_res / min(u_res.x, u_res.y);
  vec2 d = (uv - 0.5) * asp;
  vec2 dc = 0.5 * asp;

  vec3 rgb;
  if (u_chroma > 0.0) {
    vec2 o = d * (u_chroma * 0.07 * dot(d, d) / dot(dc, dc));
    vec2 ou = o / asp;
    float r = (texture2D(u_src, uv + 0.33 * ou).r + texture2D(u_src, uv + 0.66 * ou).r + texture2D(u_src, uv + ou).r) / 3.0;
    float g = texture2D(u_src, uv).g;
    float b = (texture2D(u_src, uv - 0.33 * ou).b + texture2D(u_src, uv - 0.66 * ou).b + texture2D(u_src, uv - ou).b) / 3.0;
    rgb = vec3(r, g, b);
  } else {
    rgb = texture2D(u_src, uv).rgb;
  }

  if (u_vig > 0.0) {
    float v = length(d) / length(dc);
    vec3 lin = srgbToLinear(rgb);
    lin *= 1.0 - u_vig * 0.82 * smoothstep(0.28, 1.08, v);
    rgb = linearToSrgb(lin);
  }

  if (u_scan > 0.0) {
    float period = cellPx(3.0);
    float s = 0.5 - 0.5 * cos(6.28318530718 * fract(pos.y / period));
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
        for (const n of ['u_src', 'u_blue', 'u_res', 'u_unit', 'u_chroma', 'u_vig', 'u_scan', 'u_grain', 'u_coarse', 'u_levels', 'u_blueMode']) {
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

  /** Resolve the offscreen field to the default framebuffer through the post shader. */
  draw(fx: FxState, unit: number): void {
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
    gl.uniform1f(this.u.u_grain, fx.grain / 100);
    gl.uniform1f(this.u.u_coarse, fx.grainSize === 'coarse' ? 1 : 0);
    gl.uniform1f(this.u.u_levels, fx.dither);
    gl.uniform1f(this.u.u_blueMode, blue ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
