import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TileRequest, WorkerOutbound } from '@/workers/messages';

const runGpuFractalProbeMock = vi.hoisted(() => vi.fn());

vi.mock('@/fingerprint', () => ({
  computeDeviceFingerprint: vi.fn(async () => ({
    id: 'browser-profile',
    canonical: '{}',
    observation: { schemaVersion: 1 },
    warnings: [],
  })),
}));

vi.mock('@/fingerprint/probes/fractalGpu', () => ({
  runGpuFractalProbe: runGpuFractalProbeMock,
}));

vi.mock('@/fingerprint/matchClient', () => ({
  registerDeviceObservation: vi.fn(async () => ({
    deviceClusterId: 'device-cluster',
    confidence: 0.92,
    evidence: 0.81,
    matched: true,
  })),
}));

import { analyzeMatrixVariance, runDeviceProfileProbe } from './quantumDiagnostics';

type WorkerMode = 'success' | 'message-error';

class FakeWorker {
  static instances: FakeWorker[] = [];
  static mode: WorkerMode = 'success';

  onmessage: ((event: MessageEvent<WorkerOutbound>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

  postMessage(message: TileRequest) {
    queueMicrotask(() => {
      if (this.terminated) return;
      if (FakeWorker.mode === 'message-error') {
        this.onmessage?.({
          data: {
            type: 'pws:error',
            jobId: message.jobId,
            message: 'worker failed',
          },
        } as MessageEvent<WorkerOutbound>);
        return;
      }

      const errorChunk = new Float32Array(message.width * (message.endY - message.startY));
      errorChunk.fill(message.startY + 1);
      this.onmessage?.({
        data: {
          type: 'pws:tile-response',
          jobId: message.jobId,
          startY: message.startY,
          errorChunk,
        },
      } as MessageEvent<WorkerOutbound>);
    });
  }

  terminate() {
    this.terminated = true;
  }
}

describe('runDeviceProfileProbe', () => {
  beforeEach(() => {
    FakeWorker.instances = [];
    FakeWorker.mode = 'success';
    runGpuFractalProbeMock.mockReset();
    runGpuFractalProbeMock.mockResolvedValue({
      grid: new Float32Array([1, 2, 3, 4]),
      durationMs: 12.5,
    });

    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('aggregates worker tiles and terminates every worker', async () => {
    const result = await new Promise((resolve, reject) => {
      runDeviceProfileProbe({
        width: 2,
        height: 2,
        zoom: 0.05,
        logUpdate: () => undefined,
        onComplete: resolve,
        onError: reject,
      });
    });

    expect(result).toMatchObject({
      browserProfileId: 'browser-profile',
      deviceClusterId: 'device-cluster',
      deviceMatchConfidence: 0.92,
      matchedExistingDevice: true,
      fractalBackend: 'cpu-worker',
    });
    expect(FakeWorker.instances).toHaveLength(2);
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });

  it('prefers WebGPU and forwards the optional stability setting', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2, gpu: {} });

    const result = await new Promise((resolve, reject) => {
      runDeviceProfileProbe({
        width: 2,
        height: 2,
        zoom: 0.05,
        logUpdate: () => undefined,
        onComplete: resolve,
        onError: reject,
        gpuStabilityEnabled: true,
      });
    });

    expect(result).toMatchObject({
      fractalBackend: 'webgpu',
      fractalDurationMs: 12.5,
    });
    expect(runGpuFractalProbeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        width: 2,
        height: 2,
        stabilityTest: true,
      }),
    );
    expect(FakeWorker.instances).toHaveLength(0);
  });

  it('falls back to CPU workers when WebGPU execution fails', async () => {
    runGpuFractalProbeMock.mockRejectedValue(new Error('device unavailable'));
    vi.stubGlobal('navigator', { hardwareConcurrency: 2, gpu: {} });

    const result = await new Promise((resolve, reject) => {
      runDeviceProfileProbe({
        width: 2,
        height: 2,
        zoom: 0.05,
        logUpdate: () => undefined,
        onComplete: resolve,
        onError: reject,
      });
    });

    expect(result).toMatchObject({
      fractalBackend: 'cpu-worker',
    });
    expect(FakeWorker.instances).toHaveLength(2);
  });

  it('reports worker messages as errors and cleans up the pool', async () => {
    FakeWorker.mode = 'message-error';
    const onComplete = vi.fn();

    const error = await new Promise<Error>((resolve) => {
      runDeviceProfileProbe({
        width: 2,
        height: 2,
        zoom: 0.05,
        logUpdate: () => undefined,
        onComplete,
        onError: resolve,
      });
    });

    expect(error.message).toBe('worker failed');
    expect(onComplete).not.toHaveBeenCalled();
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });

  it('cancels outstanding workers without invoking callbacks', async () => {
    const onComplete = vi.fn();
    const onError = vi.fn();
    const controller = runDeviceProfileProbe({
      width: 2,
      height: 2,
      zoom: 0.05,
      logUpdate: () => undefined,
      onComplete,
      onError,
    });

    controller.cancel();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onComplete).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(FakeWorker.instances.every((worker) => worker.terminated)).toBe(true);
  });
});

describe('analyzeMatrixVariance', () => {
  it('does not report non-finite grid values as a zero average', () => {
    expect(analyzeMatrixVariance(new Float32Array([1, 3, NaN, Infinity]))).toEqual({
      activeGlitches: 2,
      averageDrift: 2,
      invalidValues: 2,
    });
  });
});
