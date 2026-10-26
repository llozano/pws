export interface FractalGridComparison {
  changedPixels: number;
  changedPixelRatio: number;
  meanAbsoluteDelta: number;
  maxAbsoluteDelta: number;
}

export interface FractalPhaseMetrics extends FractalGridComparison {
  medianDurationMs: number;
  timingDispersion: number;
}

export interface GpuFractalStability {
  gridWidth: number;
  gridHeight: number;
  baseline: FractalPhaseMetrics;
  loaded: FractalPhaseMetrics;
  recovered: FractalPhaseMetrics;
  stressDurationMs: number;
  stressPasses: number;
}

export interface GpuFractalProbeResult {
  grid: Float32Array;
  durationMs: number;
  stability?: GpuFractalStability;
}

export interface GpuFractalProbeOptions {
  width: number;
  height: number;
  zoom: number;
  maxIterations?: number;
  stabilityTest?: boolean;
  stressDurationMs?: number;
  cooldownMs?: number;
  signal?: AbortSignal;
  onStatus?: (message: string) => void;
}

interface FractalSample {
  grid: Float32Array;
  durationMs: number;
}

const WORKGROUP_SIZE = 8;
const MAX_GRID_ELEMENTS = 4_194_304;
const MAX_ITERATIONS = 300;
const STABILITY_GRID_SIZE = 512;

const FRACTAL_SHADER = `
  struct Params {
    width: u32,
    height: u32,
    maxIterations: u32,
    _padding0: u32,
    zoom: f32,
    targetX: f32,
    targetY: f32,
    _padding1: f32,
  };

  @group(0) @binding(0) var<storage, read_write> output: array<f32>;
  @group(0) @binding(1) var<uniform> params: Params;

  @compute @workgroup_size(8, 8, 1)
  fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.width || gid.y >= params.height) {
      return;
    }

    let width = f32(params.width);
    let height = f32(params.height);
    let uvX = (f32(gid.x) - 0.5 * width) / height;
    let uvY = (f32(gid.y) - 0.5 * height) / height;
    let cx = uvX * 2.5 * params.zoom + params.targetX;
    let cy = uvY * 2.5 * params.zoom + params.targetY;

    var continuousValue = vec2<f32>(0.0, 0.0);
    var quantized = vec2<f32>(0.0, 0.0);
    var accumulatedError = 0.0;

    for (var iteration = 0u; iteration < params.maxIterations; iteration = iteration + 1u) {
      continuousValue = vec2<f32>(
        continuousValue.x * continuousValue.x - continuousValue.y * continuousValue.y + cx,
        2.0 * continuousValue.x * continuousValue.y + cy,
      );

      quantized = vec2<f32>(
        quantized.x * quantized.x - quantized.y * quantized.y + cx,
        2.0 * quantized.x * quantized.y + cy,
      );
      quantized =
        floor(quantized * ${MANDELBROT_PROBE.quantizationScale.toFixed(1)}) /
        ${MANDELBROT_PROBE.quantizationScale.toFixed(1)};

      accumulatedError =
        accumulatedError +
        min(
          distance(continuousValue, quantized),
          ${MANDELBROT_PROBE.maxDeltaPerIteration.toFixed(1)},
        );
      if (
        dot(continuousValue, continuousValue) > 4.0 ||
        dot(quantized, quantized) > 4.0
      ) {
        break;
      }
    }

    output[gid.y * params.width + gid.x] = accumulatedError;
  }
`;

/** Creates a consistent cancellation error for all probe exit paths. */
function abortError(message = 'The GPU fractal probe was cancelled.'): DOMException {
  return new DOMException(message, 'AbortError');
}

/** Stops work after cancellation or when measurements would be distorted in a hidden page. */
function checkActive(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
    throw abortError('The GPU fractal probe stopped because the page is hidden.');
  }
}

/** Converts WebGPU device loss into a rejected promise that can join operation races. */
function deviceLost(device: GPUDevice): Promise<never> {
  return device.lost.then((info) => {
    throw new Error(`WebGPU device lost: ${info.message || info.reason}`);
  });
}

/** Rejects silent no-op dispatches and numerical output that cannot be analyzed. */
function validateGpuGrid(grid: Float32Array): void {
  let positiveValues = 0;
  for (const value of grid) {
    if (!Number.isFinite(value)) {
      throw new Error('WebGPU fractal produced a non-finite value.');
    }
    if (value > 0) positiveValues++;
  }
  if (positiveValues === 0) {
    throw new Error('WebGPU fractal produced an empty output grid.');
  }
}

/** Validates public inputs and applies bounded workload defaults. */
function validateOptions(options: GpuFractalProbeOptions): {
  maxIterations: number;
  stressDurationMs: number;
  cooldownMs: number;
} {
  if (
    !Number.isInteger(options.width) ||
    !Number.isInteger(options.height) ||
    options.width <= 0 ||
    options.height <= 0 ||
    options.width * options.height > MAX_GRID_ELEMENTS
  ) {
    throw new Error('GPU fractal dimensions are invalid or exceed the safety limit.');
  }
  if (!Number.isFinite(options.zoom) || options.zoom <= 0) {
    throw new Error('GPU fractal zoom must be a positive number.');
  }

  return {
    maxIterations: Math.min(
      MAX_ITERATIONS,
      Math.max(1, Math.floor(options.maxIterations ?? MANDELBROT_PROBE.defaultMaxIterations)),
    ),
    stressDurationMs: Math.min(2_500, Math.max(250, options.stressDurationMs ?? 1_200)),
    cooldownMs: Math.min(2_000, Math.max(0, options.cooldownMs ?? 500)),
  };
}

/** Packs Mandelbrot settings into the uniform layout expected by the WGSL shader. */
function createParamsBuffer(
  device: GPUDevice,
  width: number,
  height: number,
  zoom: number,
  maxIterations: number,
): GPUBuffer {
  const data = new ArrayBuffer(32);
  const view = new DataView(data);
  view.setUint32(0, width, true);
  view.setUint32(4, height, true);
  view.setUint32(8, maxIterations, true);
  view.setFloat32(16, zoom, true);
  view.setFloat32(20, MANDELBROT_PROBE.targetX, true);
  view.setFloat32(24, MANDELBROT_PROBE.targetY, true);

  const buffer = device.createBuffer({
    size: data.byteLength,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, data);
  return buffer;
}

/** Binds the output and parameter buffers for one fractal pipeline. */
function createBindGroup(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  output: GPUBuffer,
  params: GPUBuffer,
): GPUBindGroup {
  return device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: output } },
      { binding: 1, resource: { buffer: params } },
    ],
  });
}

/** Encodes one or more identical Mandelbrot dispatches into a command buffer. */
function encodeFractalPass(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  bindGroup: GPUBindGroup,
  width: number,
  height: number,
  repeatCount = 1,
): GPUCommandBuffer {
  const encoder = device.createCommandEncoder();
  for (let repeat = 0; repeat < repeatCount; repeat++) {
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_SIZE), Math.ceil(height / WORKGROUP_SIZE));
    pass.end();
  }
  return encoder.finish();
}

/** Runs one measured dispatch and copies its grid back to JavaScript. */
async function runSample(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  width: number,
  height: number,
  zoom: number,
  maxIterations: number,
  signal?: AbortSignal,
): Promise<FractalSample> {
  checkActive(signal);
  const byteLength = width * height * Float32Array.BYTES_PER_ELEMENT;
  if (
    byteLength > device.limits.maxBufferSize ||
    byteLength > device.limits.maxStorageBufferBindingSize
  ) {
    throw new Error('GPU fractal output exceeds this device buffer limit.');
  }

  const params = createParamsBuffer(device, width, height, zoom, maxIterations);
  const output = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const readback = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  let mapped = false;

  try {
    const bindGroup = createBindGroup(device, pipeline, output, params);
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(width / WORKGROUP_SIZE), Math.ceil(height / WORKGROUP_SIZE));
    pass.end();
    encoder.copyBufferToBuffer(output, 0, readback, 0, byteLength);

    const startedAt = performance.now();
    device.queue.submit([encoder.finish()]);
    await Promise.race([readback.mapAsync(GPUMapMode.READ), deviceLost(device)]);
    mapped = true;
    checkActive(signal);
    const grid = new Float32Array(readback.getMappedRange()).slice();
    validateGpuGrid(grid);

    return {
      grid,
      durationMs: performance.now() - startedAt,
    };
  } finally {
    if (mapped) readback.unmap();
    params.destroy();
    output.destroy();
    readback.destroy();
  }
}

/** Repeats bounded dispatch batches without readback to create controlled GPU load. */
async function runStress(
  device: GPUDevice,
  pipeline: GPUComputePipeline,
  width: number,
  height: number,
  zoom: number,
  maxIterations: number,
  durationMs: number,
  signal?: AbortSignal,
): Promise<{ durationMs: number; passes: number }> {
  const byteLength = width * height * Float32Array.BYTES_PER_ELEMENT;
  const params = createParamsBuffer(device, width, height, zoom, maxIterations);
  const output = device.createBuffer({
    size: byteLength,
    usage: GPUBufferUsage.STORAGE,
  });

  try {
    const bindGroup = createBindGroup(device, pipeline, output, params);
    const startedAt = performance.now();
    let passes = 0;

    while (performance.now() - startedAt < durationMs && passes < 256) {
      checkActive(signal);
      device.queue.submit([encodeFractalPass(device, pipeline, bindGroup, width, height, 4)]);
      await Promise.race([device.queue.onSubmittedWorkDone(), deviceLost(device)]);
      passes += 4;
    }

    return {
      durationMs: performance.now() - startedAt,
      passes,
    };
  } finally {
    params.destroy();
    output.destroy();
  }
}

/** Returns the median so timing summaries are less sensitive to individual spikes. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Summarizes phase timing with a median and relative median absolute deviation. */
function timingMetrics(samples: FractalSample[]): {
  medianDurationMs: number;
  timingDispersion: number;
} {
  const durations = samples.map(({ durationMs }) => durationMs);
  const center = median(durations);
  return {
    medianDurationMs: center,
    timingDispersion:
      center > 0 ? median(durations.map((duration) => Math.abs(duration - center))) / center : 1,
  };
}

/** Compares two grids using a small relative tolerance for floating-point noise. */
export function compareFractalGrids(
  reference: Float32Array,
  candidate: Float32Array,
): FractalGridComparison {
  if (reference.length !== candidate.length || reference.length === 0) {
    throw new Error('Fractal grids must have the same non-zero length.');
  }

  let changedPixels = 0;
  let totalDelta = 0;
  let maxAbsoluteDelta = 0;

  for (let index = 0; index < reference.length; index++) {
    const left = reference[index];
    const right = candidate[index];
    let delta: number;

    if (Object.is(left, right)) {
      delta = 0;
    } else if (Number.isFinite(left) && Number.isFinite(right)) {
      delta = Math.abs(left - right);
    } else {
      delta = 1_000_000;
    }

    const tolerance = Math.max(1e-5, Math.abs(left) * 1e-4);
    if (delta > tolerance) changedPixels++;
    totalDelta += delta;
    maxAbsoluteDelta = Math.max(maxAbsoluteDelta, delta);
  }

  return {
    changedPixels,
    changedPixelRatio: changedPixels / reference.length,
    meanAbsoluteDelta: totalDelta / reference.length,
    maxAbsoluteDelta,
  };
}

/** Combines numerical and timing results for one stability-test phase. */
function summarizePhase(
  reference: Float32Array,
  samples: FractalSample[],
  timingSamples: FractalSample[] = samples,
): FractalPhaseMetrics {
  const comparisons = samples.map(({ grid }) => compareFractalGrids(reference, grid));
  const divisor = Math.max(1, comparisons.length);
  const timing = timingMetrics(timingSamples);

  return {
    changedPixels: Math.round(
      comparisons.reduce((total, value) => total + value.changedPixels, 0) / divisor,
    ),
    changedPixelRatio:
      comparisons.reduce((total, value) => total + value.changedPixelRatio, 0) / divisor,
    meanAbsoluteDelta:
      comparisons.reduce((total, value) => total + value.meanAbsoluteDelta, 0) / divisor,
    maxAbsoluteDelta: comparisons.reduce(
      (maximum, value) => Math.max(maximum, value.maxAbsoluteDelta),
      0,
    ),
    ...timing,
  };
}

/** Waits for cooldown while remaining responsive to cancellation and page visibility. */
async function delay(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (durationMs <= 0) return;
  checkActive(signal);

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);
    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  checkActive(signal);
}

/** Runs the primary WebGPU fractal and, when requested, the full stability sequence. */
export async function runGpuFractalProbe(
  options: GpuFractalProbeOptions,
): Promise<GpuFractalProbeResult> {
  const { maxIterations, stressDurationMs, cooldownMs } = validateOptions(options);
  if (!navigator.gpu) throw new Error('WebGPU is unavailable.');
  checkActive(options.signal);

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) throw new Error('No WebGPU adapter is available.');

  const device = await adapter.requestDevice();
  try {
    const shaderModule = device.createShaderModule({ code: FRACTAL_SHADER });
    const compilationInfo = await shaderModule.getCompilationInfo();
    const compilationErrors = compilationInfo.messages.filter(({ type }) => type === 'error');
    if (compilationErrors.length > 0) {
      throw new Error(
        `WebGPU fractal shader failed: ${compilationErrors
          .map(({ message }) => message)
          .join('; ')}`,
      );
    }
    const pipeline = await device.createComputePipelineAsync({
      layout: 'auto',
      compute: { module: shaderModule, entryPoint: 'main' },
    });

    options.onStatus?.('Running the fractal on WebGPU...');
    const primary = await runSample(
      device,
      pipeline,
      options.width,
      options.height,
      options.zoom,
      maxIterations,
      options.signal,
    );

    if (!options.stabilityTest) return primary;

    const stabilityWidth = Math.min(options.width, STABILITY_GRID_SIZE);
    const stabilityHeight = Math.min(options.height, STABILITY_GRID_SIZE);
    options.onStatus?.('Capturing cold GPU stability samples...');
    const baselineReference =
      stabilityWidth === options.width && stabilityHeight === options.height
        ? primary
        : await runSample(
            device,
            pipeline,
            stabilityWidth,
            stabilityHeight,
            options.zoom,
            maxIterations,
            options.signal,
          );
    const baselineSamples = [
      await runSample(
        device,
        pipeline,
        stabilityWidth,
        stabilityHeight,
        options.zoom,
        maxIterations,
        options.signal,
      ),
    ];

    options.onStatus?.('Applying a bounded GPU fractal workload...');
    const stress = await runStress(
      device,
      pipeline,
      stabilityWidth,
      stabilityHeight,
      options.zoom,
      maxIterations,
      stressDurationMs,
      options.signal,
    );

    options.onStatus?.('Capturing loaded GPU samples...');
    const loadedSamples = [
      await runSample(
        device,
        pipeline,
        stabilityWidth,
        stabilityHeight,
        options.zoom,
        maxIterations,
        options.signal,
      ),
      await runSample(
        device,
        pipeline,
        stabilityWidth,
        stabilityHeight,
        options.zoom,
        maxIterations,
        options.signal,
      ),
    ];

    options.onStatus?.('Cooling down before the recovery sample...');
    await delay(cooldownMs, options.signal);
    const recoveredSamples = [
      await runSample(
        device,
        pipeline,
        stabilityWidth,
        stabilityHeight,
        options.zoom,
        maxIterations,
        options.signal,
      ),
      await runSample(
        device,
        pipeline,
        stabilityWidth,
        stabilityHeight,
        options.zoom,
        maxIterations,
        options.signal,
      ),
    ];

    return {
      ...primary,
      stability: {
        gridWidth: stabilityWidth,
        gridHeight: stabilityHeight,
        baseline: summarizePhase(baselineReference.grid, baselineSamples, [
          baselineReference,
          ...baselineSamples,
        ]),
        loaded: summarizePhase(baselineReference.grid, loadedSamples),
        recovered: summarizePhase(baselineReference.grid, recoveredSamples),
        stressDurationMs: stress.durationMs,
        stressPasses: stress.passes,
      },
    };
  } finally {
    device.destroy();
  }
}
import { MANDELBROT_PROBE } from '../fractalConfig';
