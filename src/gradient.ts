const VERT = `
attribute vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2  u_res;
uniform float u_scale;
uniform vec2  u_pos[9];
uniform float u_rad[9];
uniform vec3  u_lab[9];
uniform float u_time;
uniform float u_grain;
uniform float u_min;
uniform float u_warp;

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

void main() {
  vec2 p = gl_FragCoord.xy / u_scale;
  p.y = u_res.y / u_scale - p.y;

  // Low-frequency domain warp in short-side units so screen and export agree.
  vec2 n = p / u_min;
  float t = u_time * 0.035;
  vec2 q = vec2(
    fbm(n * 1.7 + vec2(t, 0.3 * t)),
    fbm(n * 1.7 + vec2(5.2, 1.3) - vec2(0.2 * t, t)));
  vec2 pw = p + (q - 0.44) * u_warp;

  vec3 acc = vec3(0.0);
  float wsum = 0.0;
  for (int i = 0; i < 9; i++) {
    float q2 = distance(pw, u_pos[i]) / u_rad[i];
    float w = exp(-q2 * q2 * 1.5) + 0.05 / (1.0 + q2 * q2 * q2 * q2);
    acc += u_lab[i] * w;
    wsum += w;
  }
  vec3 rgb = linearToSrgb(oklabToLinear(acc / wsum));

  float gt = floor(u_time * 24.0);
  float g1 = hash(gl_FragCoord.xy + vec2(gt * 7.13, gt * 3.71)) - 0.5;
  float g2 = hash(floor(gl_FragCoord.xy * 0.5) + vec2(gt * 1.3, 11.0)) - 0.5;
  rgb += g1 * u_grain + g2 * u_grain * 0.6;

  gl_FragColor = vec4(rgb, 1.0);
}
`;

/** Warp gain: fbm deviation (~±0.35) × gain ≈ ±6 % of the short side. */
const WARP = 0.17;

export interface FieldParams {
  /** Node centres in CSS px of the canvas. */
  positions: Float32Array;
  /** Radii in CSS px. */
  radii: Float32Array;
  /** OKLab colours, 9 × 3. */
  lab: Float32Array;
  time: number;
  grain: number;
}

export class GradientRenderer {
  readonly gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private cssW = 1;
  private cssH = 1;
  private scale = 1;

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
    this.program = this.link(VERT, FRAG);
    gl.useProgram(this.program);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.program, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    for (const name of ['u_res', 'u_scale', 'u_pos', 'u_rad', 'u_lab', 'u_time', 'u_grain', 'u_min', 'u_warp']) {
      this.u[name] = gl.getUniformLocation(this.program, name);
    }
  }

  private compile(type: number, src: string): WebGLShader {
    const gl = this.gl;
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
    }
    return sh;
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const p = gl.createProgram()!;
    gl.attachShader(p, this.compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, this.compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? 'program link failed');
    }
    return p;
  }

  /** Size the drawing buffer. `scale` maps CSS px → buffer px. */
  resize(cssW: number, cssH: number, scale: number): void {
    this.cssW = Math.max(1, cssW);
    this.cssH = Math.max(1, cssH);
    this.scale = scale;
    const w = Math.round(this.cssW * scale);
    const h = Math.round(this.cssH * scale);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  render(p: FieldParams): void {
    const gl = this.gl;
    gl.useProgram(this.program);
    gl.uniform2f(this.u.u_res, this.canvas.width, this.canvas.height);
    gl.uniform1f(this.u.u_scale, this.scale);
    gl.uniform2fv(this.u.u_pos, p.positions);
    gl.uniform1fv(this.u.u_rad, p.radii);
    gl.uniform3fv(this.u.u_lab, p.lab);
    gl.uniform1f(this.u.u_time, p.time);
    gl.uniform1f(this.u.u_grain, p.grain);
    const min = Math.min(this.cssW, this.cssH);
    gl.uniform1f(this.u.u_min, min);
    gl.uniform1f(this.u.u_warp, min * WARP);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
