import { fnv1a } from '../hash';

export interface WebGPUSignals {
  adapter: {
    vendor: string;
    architecture: string;
    device: string;
    description: string;
    features: string[];
    limits: Record<string, number>;
  };
  matrixHash: string;
  // Contention timing as a fraction of a reference loop → scheduler fingerprint.
  atomicScaling: number[];
}

export async function collectWebGPUSignals(): Promise<WebGPUSignals | null> {
  if (!('gpu' in navigator)) return null;
  const adapter = await (navigator as any).gpu.requestAdapter({
    powerPreference: 'high-performance',
  });
  if (!adapter) return null;

  const info = (adapter as any).info ?? {}; // GPUAdapterInfo where available
  const features = [...adapter.features].sort();
  const limits: Record<string, number> = {};
  for (const k of Object.keys(adapter.limits)) {
    const v = (adapter.limits as any)[k];
    if (typeof v === 'number') limits[k] = v;
  }

  const device = await adapter.requestDevice();

  const matrixHash = await runMatrixProbe(device);
  const atomicScaling = await runAtomicContentionProbe(device);

  return {
    adapter: {
      vendor: info.vendor ?? '',
      architecture: info.architecture ?? '',
      device: info.device ?? '',
      description: info.description ?? '',
      features,
      limits,
    },
    matrixHash,
    atomicScaling,
  };
}

// ---------------------------------------------------------------------------
// Matrix multiplication: FP rounding differs across GPU FP pipelines.
// ---------------------------------------------------------------------------
async function runMatrixProbe(device: GPUDevice): Promise<string> {
  const N = 32;
  const a = new Float32Array(N * N);
  const b = new Float32Array(N * N);
  for (let i = 0; i < N * N; i++) {
    a[i] = Math.sin(i * 1.0001) * 0.37;
    b[i] = Math.cos(i * 0.9931) * 0.41;
  }

  const mkBuf = (data: ArrayBufferView, usage: GPUBufferUsageFlags) => {
    const buf = device.createBuffer({
      size: Math.max(16, (data as any).byteLength),
      usage: usage | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
      mappedAtCreation: true,
    });
    new Uint8Array(buf.getMappedRange()).set(
      new Uint8Array((data as any).buffer, (data as any).byteOffset, (data as any).byteLength),
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
  const module = device.createShaderModule({ code: wgsl });
  const pipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
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

  const enc = device.createCommandEncoder();
  const pass = enc.beginComputePass();
  pass.setPipeline(pipeline);
  pass.setBindGroup(0, bind);
  pass.dispatchWorkgroups(Math.ceil(N / 8), Math.ceil(N / 8));
  pass.end();

  const readBuf = device.createBuffer({
    size: N * N * 4,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  enc.copyBufferToBuffer(bufC, 0, readBuf, 0, N * N * 4);
  device.queue.submit([enc.finish()]);

  await readBuf.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(readBuf.getMappedRange()).slice();
  readBuf.unmap();

  return fnv1a(bytes);
}

// ---------------------------------------------------------------------------
// Atomic contention scaling: measures how atomic throughput scales with N.
// The shape of this curve depends on the number of L2 slices, shader cores,
// and scheduling policy — a strong microarchitectural fingerprint.
// ---------------------------------------------------------------------------
async function runAtomicContentionProbe(device: GPUDevice): Promise<number[]> {
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
  const module = device.createShaderModule({ code: wgsl });

  const samples: number[] = [];
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

    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint: 'main' },
    });
    const bind = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: counters } },
        { binding: 1, resource: { buffer: params } },
      ],
    });

    // warm up
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

    const t0 = performance.now();
    for (let r = 0; r < 5; r++) {
      const enc = device.createCommandEncoder();
      const pass = enc.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bind);
      pass.dispatchWorkgroups(32);
      pass.end();
      device.queue.submit([enc.finish()]);
    }
    await device.queue.onSubmittedWorkDone();
    samples.push(performance.now() - t0);
  }
  return samples;
}
