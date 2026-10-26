export interface MatrixSignature {
  mean: number;
  variance: number;
  min: number;
  max: number;
  quantized: string;
}

export interface WebGPUSignals {
  adapter: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    features: string[];
    limits: Record<string, number>;
  };
  matrix: MatrixSignature;
  timing: {
    ratios: number[];
    dispersion: number;
  };
}

export async function collectWebGPUSignals(): Promise<WebGPUSignals | null> {
  if (!navigator.gpu) return null;
  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return null;

  const info = adapter.info;
  const features = [...adapter.features].sort();
  const limits: Record<string, number> = {};
  for (const k of Object.keys(adapter.limits)) {
    const v = Reflect.get(adapter.limits, k);
    if (typeof v === 'number') limits[k] = v;
  }

  const device = await adapter.requestDevice();
  try {
    const matrix = await runMatrixProbe(device);
    const timing = await runAtomicContentionProbe(device);

    return {
      adapter: {
        vendor: info.vendor ?? '',
        architecture: info.architecture ?? '',
        device: info.device ?? '',
        description: info.description ?? '',
        features,
        limits,
      },
      matrix,
      timing,
    };
  } finally {
    device.destroy();
  }
}

// ---------------------------------------------------------------------------
// Matrix multiplication: FP rounding differs across GPU FP pipelines.
// ---------------------------------------------------------------------------
async function runMatrixProbe(device: GPUDevice): Promise<MatrixSignature> {
  const N = 32;
  const a = new Float32Array(N * N);
  const b = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    a[i] = Math.sin(i * 1.0001) * 0.37;
    b[i] = Math.cos(i * 0.9931) * 0.41;
  }

  const mkBuf = (data: ArrayBufferView, usage: GPUBufferUsageFlags) => {
    const buf = device.createBuffer({
      size: Math.max(16, data.byteLength),
      usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Uint8Array(buf.getMappedRange()).set(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
    buf.unmap();
    return buf;
  };

  const bufA = mkBuf(a, GPUBufferUsage.STORAGE);
  const bufB = mkBuf(b, GPUBufferUsage.STORAGE);
  const bufC = device.createBuffer({
    size: N * N * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
  });
  const params = new Uint32Array([N, 0, 0, 0]);
  const bufP = mkBuf(params, GPUBufferUsage.UNIFORM);

  const wgsl = `
    struct Params { n: u32, _0: u32, _1: u32, _2: u32 };
    @group(0) @binding(0) var<storage, read> A: array<f32>;
    @group(0) @binding(1) var<storage, read> B: array<f32>;
    @group(0) @binding(2) var<storage, read_write> C: array<f32>;
    @group(0) @binding(3) var<uniform> P: Params;

    @compute @workgroup_size(8,8,1)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let n = P.n;
      if (gid.x >= n || gid.y >= n) { return; }
      var acc = 0.0;
      for (var k = 0u; k < n; k = k + 1u) {
        acc = acc + A[gid.x * n + k] * B[k * n + gid.y];
      }
      C[gid.x * n + gid.y] = acc;
    }
  `;
  const shaderModule = device.createShaderModule({ code: wgsl });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });
  const bind = device.createBindGroup({
    layout: pipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: bufA } },
      { binding: 1, resource: { buffer: bufB } },
      { binding: 2, resource: { buffer: bufC } },
      { binding: 3, resource: { buffer: bufP } },
    ],
  });

  const readBuf = device.createBuffer({
    size: N * N * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });

  try {
    const enc = device.createCommandEncoder();
    const pass = enc.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bind);
    pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
    pass.end();
    enc.copyBufferToBuffer(bufC, 0, readBuf, 0, N * N * 4);
    device.queue.submit([enc.finish()]);

    await readBuf.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(readBuf.getMappedRange()).slice();
    readBuf.unmap();

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const value of values) {
      min = Math.min(min, value);
      max = Math.max(max, value);
      sum += value;
    }
    const mean = sum / values.length;
    let variance = 0;
    for (const value of values) {
      const delta = value - mean;
      variance += delta * delta;
    }
    variance /= values.length;

    const span = max - min || 1;
    const buckets: number[] = [];
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const value = values[y * 4 * N + x * 4];
        buckets.push(Math.min(7, Math.max(0, Math.floor(((value - min) / span) * 8))));
      }
    }

    return {
      mean,
      variance,
      min,
      max,
      quantized: buckets.join(' '),
    };
  } finally {
    bufA.destroy();
    bufB.destroy();
    bufC.destroy();
    bufP.destroy();
    readBuf.destroy();
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

async function runAtomicContentionProbe(device: GPUDevice): Promise<WebGPUSignals['timing']> {
  const wgsl = `
    struct Params { iters: u32, _0: u32, _1: u32, _2: u32 };
    @group(0) @binding(0) var<storage, read_write> counters: array<atomic<u32>>;
    @group(0) @binding(1) var<uniform> P: Params;

    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      for (var i = 0u; i < P.iters; i = i + 1u) {
        let idx = (gid.x * 2654435761u + i) % arrayLength(&counters);
        atomicAdd(&counters[idx], 1u);
      }
    }
  `;
  const shaderModule = device.createShaderModule({ code: wgsl });

  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: shaderModule, entryPoint: 'main' },
  });
  const measurements: Array<{ duration: number; dispersion: number }> = [];
  for (const N of [1, 2, 4, 8, 16, 32]) {
    const counters = device.createBuffer({
      size: N * 4,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    device.queue.writeBuffer(counters, 0, new Uint32Array(N));

    const params = device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(params, 0, new Uint32Array([256, 0, 0, 0]));

    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: counters } },
        { binding: 1, resource: { buffer: params } },
      ],
    });

    for (let w = 0; w < 2; w++) {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(32);
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    await device.queue.onSubmittedWorkDone();

    const samples: number[] = [];
    for (let sample = 0; sample < 7; sample++) {
      const startedAt = performance.now();
      for (let repeat = 0; repeat < 5; repeat++) {
        const enc = device.createCommandEncoder();
        const pass = enc.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bind);
        pass.dispatchWorkgroups(32);
        pass.end();
        device.queue.submit([enc.finish()]);
      }
      await device.queue.onSubmittedWorkDone();
      samples.push(performance.now() - startedAt);
    }
    const duration = median(samples);
    measurements.push({
      duration,
      dispersion:
        duration > 0 ? median(samples.map((sample) => Math.abs(sample - duration))) / duration : 1,
    });
    counters.destroy();
    params.destroy();
  }
  const baseline = measurements[0]?.duration || 1;
  return {
    ratios: measurements.map(({ duration }) => duration / baseline),
    dispersion:
      measurements.reduce((total, value) => total + value.dispersion, 0) /
      Math.max(1, measurements.length),
  };
}
