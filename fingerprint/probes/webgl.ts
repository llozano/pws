import { fnv1a } from '../hash';

export interface WebGLSignals {
  renderer: string;
  vendor: string;
  version: string;
  glslVersion: string;
  extensions: string[];
  limits: Record<string, number>;
  precision: Record<string, { rangeMin: number; rangeMax: number; precision: number }>;
  shaderHash: string;
}

export function collectWebGLSignals(
  canvas: HTMLCanvasElement | OffscreenCanvas = createCanvas(),
): WebGLSignals | null {
  const gl =
    (canvas.getContext('webgl2', {
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGL2RenderingContext | null) ??
    (canvas.getContext('webgl', {
      antialias: false,
      preserveDrawingBuffer: true,
    }) as WebGLRenderingContext | null);
  if (!gl) return null;

  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  // On iOS these are typically null / empty — that's expected.
  const renderer = dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? '') : '';
  const vendor = dbg ? String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? '') : '';

  const extensions = (gl.getSupportedExtensions() ?? []).slice().sort();

  const limits: Record<string, number> = {};
  const limitNames = [
    'MAX_TEXTURE_SIZE',
    'MAX_VIEWPORT_DIMS',
    'MAX_VERTEX_ATTRIBS',
    'MAX_VERTEX_UNIFORM_VECTORS',
    'MAX_VARYING_VECTORS',
    'MAX_FRAGMENT_UNIFORM_VECTORS',
    'MAX_RENDERBUFFER_SIZE',
    'MAX_CUBE_MAP_TEXTURE_SIZE',
    'MAX_TEXTURE_IMAGE_UNITS',
    'MAX_VERTEX_TEXTURE_IMAGE_UNITS',
    'MAX_COMBINED_TEXTURE_IMAGE_UNITS',
  ];
  for (const name of limitNames) {
    const pname = (gl as any)[name] as number | undefined;
    if (pname === undefined) continue;
    const v = gl.getParameter(pname);
    if (typeof v === 'number') limits[name] = v;
  }

  const precision: WebGLSignals['precision'] = {};
  const shaders: [string, number][] = [
    ['VS', gl.VERTEX_SHADER],
    ['FS', gl.FRAGMENT_SHADER],
  ];
  const precs: [string, number][] = [
    ['LOW_FLOAT', gl.LOW_FLOAT],
    ['MEDIUM_FLOAT', gl.MEDIUM_FLOAT],
    ['HIGH_FLOAT', gl.HIGH_FLOAT],
    ['LOW_INT', gl.LOW_INT],
    ['MEDIUM_INT', gl.MEDIUM_INT],
    ['HIGH_INT', gl.HIGH_INT],
  ];
  for (const [sName, sVal] of shaders) {
    for (const [pName, pVal] of precs) {
      const f = gl.getShaderPrecisionFormat(sVal, pVal);
      if (f)
        precision[`${sName}:${pName}`] = {
          rangeMin: f.rangeMin,
          rangeMax: f.rangeMax,
          precision: f.precision,
        };
    }
  }

  const shaderHash = runShaderProbe(gl);

  return {
    renderer,
    vendor,
    version: String(gl.getParameter(gl.VERSION)),
    glslVersion: String(gl.getParameter(gl.SHADING_LANGUAGE_VERSION)),
    extensions,
    limits,
    precision,
    shaderHash,
  };
}

function createCanvas(): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(128, 128);
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 128;
  return c;
}

// ---------------------------------------------------------------------------
// Shader probe: nonlinear map with sin/cos/fract to exercise FP units.
// ---------------------------------------------------------------------------
function runShaderProbe(gl: WebGLRenderingContext): string {
  const vs = `
    attribute vec2 a_pos;
    void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }
  `;
  const fs = `
    precision highp float;
    uniform vec2 u_res;
    void main(){
      vec2 uv = gl_FragCoord.xy / u_res * 4.0 - 2.0;
      vec2 z = uv;
      vec2 c = vec2(-0.743643887037151, 0.131825904205330);
      for (int i = 0; i < 200; i++) {
        z = vec2(
          z.x*z.x - z.y*z.y + c.x + 0.001*sin(z.y*13.0),
          2.0*z.x*z.y        + c.y + 0.001*cos(z.x*11.0)
        );
      }
      float v = fract(dot(z, vec2(1.0, 2.0)) * 17.0);
      gl_FragColor = vec4(v, fract(v*3.7), fract(v*7.3), 1.0);
    }
  `;

  const prog = linkProgram(gl, vs, fs);
  if (!prog) return '';

  gl.useProgram(prog);
  const loc = gl.getAttribLocation(prog, 'a_pos');
  const buf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const res = gl.getUniformLocation(prog, 'u_res');
  gl.uniform2f(res, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
  gl.readPixels(
    0,
    0,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    pixels,
  );

  return fnv1a(pixels);
}

function linkProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string) {
  const compile = (type: number, src: string) => {
    const sh = gl.createShader(type)!;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
  };
  const vs = compile(gl.VERTEX_SHADER, vsSrc);
  const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
}
