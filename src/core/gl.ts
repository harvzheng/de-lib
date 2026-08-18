/**
 * The pack's whole renderer: one fullscreen quad, one fragment program, a
 * handful of textures. Hand-rolled WebGL2 — the pack ships zero runtime
 * dependencies, and none of the effects need a scene graph.
 *
 * Every entry point degrades instead of throwing: no WebGL2, a typo in a
 * shader, or a zero-sized canvas leaves the caller's static content visible.
 */

export type ScalarUniform = number | boolean | readonly number[] | Float32Array;

export interface TextureOptions {
  /** UNPACK_FLIP_Y_WEBGL; default true so images sample upright against `vUv`. */
  flipY?: boolean;
  /** LINEAR when true (default), NEAREST otherwise. */
  linear?: boolean;
  wrap?: 'clamp' | 'repeat';
}

export interface QuadRenderer {
  readonly canvas: HTMLCanvasElement;
  readonly gl: WebGL2RenderingContext;
  /** Drawing-buffer size in device pixels, as of the last `resize()`. */
  readonly width: number;
  readonly height: number;
  /**
   * Creates (first call) and uploads into the texture bound to sampler `name`.
   * Callers control upload timing — this is how frame decimation is implemented.
   */
  upload(name: string, source: TexImageSource, options?: TextureOptions): void;
  /**
   * Sets the named scalar/vector uniforms, binds every uploaded texture to its
   * unit, and draws the fullscreen quad. Unknown or inactive names are ignored.
   * `uResolution` (vec2, drawing-buffer px) and `uDpr` (float) are set
   * automatically when the shader declares them.
   */
  render(uniforms?: Record<string, ScalarUniform>): void;
  /** Matches the drawing buffer to the canvas CSS box x clamped DPR. True when it changed. */
  resize(): boolean;
  dispose(): void;
}

export interface QuadRendererOptions {
  /** Device-pixel-ratio ceiling; default 2. */
  dprMax?: number;
  /** Default true, with premultipliedAlpha false. */
  alpha?: boolean;
  onContextLost?: () => void;
}

/** TRIANGLE_STRIP corners in clip space: bottom-left, bottom-right, top-left, top-right. */
const QUAD_VERTICES = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
const POSITION_LOCATION = 0;

const VERTEX_SOURCE = `#version 300 es
precision highp float;

in vec2 aPos;
out vec2 vUv;

void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

/**
 * Prepended to every effect shader. Effects author bare bodies against `vUv`
 * (0..1, origin bottom-left) and write to `fragColor`.
 */
const FRAGMENT_PRELUDE = `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv;
out vec4 fragColor;
`;

interface UniformSlot {
  location: WebGLUniformLocation;
  type: number;
}

interface TextureSlot {
  texture: WebGLTexture;
  unit: number;
  /** Resolved once at creation so the per-frame bind loop stays lookup-free. */
  sampler: UniformSlot | undefined;
}

function reportShaderFailure(label: string, log: string | null, source: string): void {
  const lines = source.split('\n');
  let numbered = '';
  for (let i = 0; i < lines.length; i++) {
    numbered += `${String(i + 1).padStart(4, ' ')} | ${lines[i]}\n`;
  }
  console.error(`${label}\n${log ?? '(no info log)'}\n${numbered}`);
}

function compileShader(
  gl: WebGL2RenderingContext,
  type: GLenum,
  source: string,
  label: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    reportShaderFailure(label, gl.getShaderInfoLog(shader), source);
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/** Widens a scalar-ish uniform value; array values fall back to their first component. */
function scalarOf(value: ScalarUniform): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value.length > 0 ? value[0] : 0;
}

/** Widens a vector uniform value without copying the caller's array. */
function vectorOf(value: ScalarUniform): Iterable<number> {
  if (typeof value === 'number') return [value];
  if (typeof value === 'boolean') return [value ? 1 : 0];
  return value;
}

/**
 * Compiles a fullscreen-quad WebGL2 program. Returns null when WebGL2 is
 * unavailable or compilation fails (log to console.error with numbered source
 * lines); callers MUST handle null by falling back to their CSS renderer or
 * static content.
 */
export function createQuadRenderer(
  canvas: HTMLCanvasElement,
  fragmentSource: string,
  options: QuadRendererOptions = {},
): QuadRenderer | null {
  const gl = canvas.getContext('webgl2', {
    alpha: options.alpha ?? true,
    premultipliedAlpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (gl === null) return null;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SOURCE, 'Vertex shader failed');
  if (vertexShader === null) return null;

  const combinedFragmentSource = FRAGMENT_PRELUDE + fragmentSource;
  const fragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    combinedFragmentSource,
    'Fragment shader failed',
  );
  if (fragmentShader === null) {
    gl.deleteShader(vertexShader);
    return null;
  }

  const program = gl.createProgram();
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.bindAttribLocation(program, POSITION_LOCATION, 'aPos');
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    reportShaderFailure('Program failed to link', gl.getProgramInfoLog(program), combinedFragmentSource);
    gl.deleteProgram(program);
    return null;
  }

  const uniforms = new Map<string, UniformSlot>();
  const activeCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < activeCount; i++) {
    const info = gl.getActiveUniform(program, i);
    if (info === null) continue;
    const location = gl.getUniformLocation(program, info.name);
    if (location === null) continue;
    // Array uniforms come back as `name[0]`; effects address them as `name`.
    const name = info.name.endsWith('[0]') ? info.name.slice(0, -3) : info.name;
    uniforms.set(name, { location, type: info.type });
  }

  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTICES, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(POSITION_LOCATION);
  gl.vertexAttribPointer(POSITION_LOCATION, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const textures = new Map<string, TextureSlot>();
  const dprMax = options.dprMax ?? 2;

  let nextUnit = 0;
  let width = 0;
  let height = 0;
  let dpr = 1;
  let disposed = false;

  const handleContextLost = (event: Event): void => {
    // Without preventDefault the context can never be restored.
    event.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', handleContextLost);

  const setUniform = (name: string, value: ScalarUniform): void => {
    const slot = uniforms.get(name);
    if (slot === undefined) return;

    switch (slot.type) {
      case gl.FLOAT:
        gl.uniform1f(slot.location, scalarOf(value));
        break;
      case gl.INT:
      case gl.BOOL:
      case gl.SAMPLER_2D:
        gl.uniform1i(slot.location, scalarOf(value) | 0);
        break;
      case gl.FLOAT_VEC2:
        gl.uniform2fv(slot.location, vectorOf(value));
        break;
      case gl.FLOAT_VEC3:
        gl.uniform3fv(slot.location, vectorOf(value));
        break;
      case gl.FLOAT_VEC4:
        gl.uniform4fv(slot.location, vectorOf(value));
        break;
      case gl.INT_VEC2:
        gl.uniform2iv(slot.location, vectorOf(value));
        break;
      case gl.INT_VEC3:
        gl.uniform3iv(slot.location, vectorOf(value));
        break;
      case gl.INT_VEC4:
        gl.uniform4iv(slot.location, vectorOf(value));
        break;
      case gl.FLOAT_MAT3:
        gl.uniformMatrix3fv(slot.location, false, vectorOf(value));
        break;
      case gl.FLOAT_MAT4:
        gl.uniformMatrix4fv(slot.location, false, vectorOf(value));
        break;
      default:
        break;
    }
  };

  const renderer: QuadRenderer = {
    canvas,
    gl,

    get width(): number {
      return width;
    },

    get height(): number {
      return height;
    },

    upload(name: string, source: TexImageSource, textureOptions: TextureOptions = {}): void {
      let slot = textures.get(name);
      if (slot === undefined) {
        slot = { texture: gl.createTexture(), unit: nextUnit++, sampler: uniforms.get(name) };
        textures.set(name, slot);
      }

      const filter = (textureOptions.linear ?? true) ? gl.LINEAR : gl.NEAREST;
      const wrap = textureOptions.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;

      gl.activeTexture(gl.TEXTURE0 + slot.unit);
      gl.bindTexture(gl.TEXTURE_2D, slot.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, textureOptions.flipY ?? true);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
      // Reuses the existing texture object: re-uploading a video frame per
      // frame must not allocate.
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    },

    render(values?: Record<string, ScalarUniform>): void {
      gl.useProgram(program);
      gl.bindVertexArray(vao);

      if (values !== undefined) {
        for (const name in values) setUniform(name, values[name]);
      }

      const resolution = uniforms.get('uResolution');
      if (resolution !== undefined) gl.uniform2f(resolution.location, width, height);
      const dprUniform = uniforms.get('uDpr');
      if (dprUniform !== undefined) gl.uniform1f(dprUniform.location, dpr);

      for (const slot of textures.values()) {
        gl.activeTexture(gl.TEXTURE0 + slot.unit);
        gl.bindTexture(gl.TEXTURE_2D, slot.texture);
        if (slot.sampler !== undefined) gl.uniform1i(slot.sampler.location, slot.unit);
      }

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },

    resize(): boolean {
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      // A display:none or not-yet-laid-out canvas keeps its previous buffer.
      if (cssWidth === 0 || cssHeight === 0) return false;

      dpr = Math.min(window.devicePixelRatio || 1, dprMax);
      const nextWidth = Math.round(cssWidth * dpr);
      const nextHeight = Math.round(cssHeight * dpr);
      if (nextWidth === width && nextHeight === height) return false;

      width = nextWidth;
      height = nextHeight;
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      return true;
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;

      canvas.removeEventListener('webglcontextlost', handleContextLost);
      for (const slot of textures.values()) gl.deleteTexture(slot.texture);
      textures.clear();
      uniforms.clear();
      gl.deleteProgram(program);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
    },
  };

  return renderer;
}
