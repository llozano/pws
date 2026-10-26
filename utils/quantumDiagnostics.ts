import { computeDeviceFingerprint } from '@/fingerprint';
import { registerDeviceObservation } from '@/fingerprint/matchClient';
import type { GridFeatures } from '@/fingerprint/features';
import { runGpuFractalProbe, type GpuFractalStability } from '@/fingerprint/probes/fractalGpu';
import type { WorkerOutbound } from '@/workers/messages';

export type FractalBackend = 'webgpu' | 'cpu-worker' | 'cpu-main';

export interface QuantumLandscapeResult {
  potentialGrid: Float32Array;
  maxEnergyBarrier: number;
  tunnelingSusceptibility: number;
  systemDescription: string;
  fractalBackend?: FractalBackend;
  fractalDurationMs?: number;
  gpuStability?: GpuFractalStability;

  browserProfileId?: string;
  browserProfileCanonical?: string;
  deviceClusterId?: string;
  deviceMatchConfidence?: number;
  deviceMatchEvidence?: number;
  matchedExistingDevice?: boolean;
  deviceMatchError?: string;
  features?: GridFeatures;
}

export interface MatrixVarianceAnalysis {
  activeGlitches: number;
  averageDrift: number;
  invalidValues: number;
}

export interface DeviceProfileProbeController {
  cancel(): void;
}

export interface DeviceProfileProbeOptions {
  width: number;
  height: number;
  zoom: number;
  logUpdate: (message: string) => void;
  onComplete: (result: QuantumLandscapeResult) => void;
  audioAllowed?: boolean;
  onError?: (error: Error) => void;
  gpuStabilityEnabled?: boolean;
}

/** Converts accumulated Mandelbrot differences into the grid displayed by the UI. */
export function translateToQuantumPotential(
  errorMatrix: Float32Array,
  width: number,
  height: number,
): QuantumLandscapeResult {
  const totalElements: number = width * height;
  const potentialGrid: Float32Array = new Float32Array(totalElements);
  let maxPotential: number = 0.0;

  for (let i = 0; i < totalElements; i++) {
    potentialGrid[i] = errorMatrix[i] * 2.5;
    if (potentialGrid[i] > maxPotential) {
      maxPotential = potentialGrid[i];
    }
  }

  const tunnelingBarrierCount: number = potentialGrid.filter((v) => v > 1.5).length;
  const tunnelProbabilityRatio: number = 1.0 - tunnelingBarrierCount / totalElements;

  return {
    potentialGrid,
    maxEnergyBarrier: maxPotential,
    tunnelingSusceptibility: tunnelProbabilityRatio,
    systemDescription: 'Synthetic potential landscape derived from controlled rounding differences',
  };
}

/** Coordinates WebGPU execution, CPU fallback, cancellation, and fingerprint collection. */
export function runDeviceProfileProbe(
  options: DeviceProfileProbeOptions,
): DeviceProfileProbeController {
  const {
    width,
    height,
    zoom,
    logUpdate,
    onComplete,
    audioAllowed = false,
    onError = () => undefined,
    gpuStabilityEnabled = false,
  } = options;
  const workers = new Set<Worker>();
  const completedWorkers = new Set<Worker>();
  const abortController = new AbortController();
  let settled = false;
  const timeoutId = setTimeout(
    () => {
      fail(new Error('The device-profile computation timed out.'));
    },
    gpuStabilityEnabled ? 90_000 : 60_000,
  );

  // Stops every active CPU fallback worker.
  const terminateWorkers = () => {
    for (const worker of workers) {
      worker.terminate();
    }
    workers.clear();
  };

  // Delivers one successful result and prevents later callbacks.
  const complete = (result: QuantumLandscapeResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    terminateWorkers();
    onComplete(result);
  };

  // Cancels all work before reporting a terminal probe error.
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    abortController.abort();
    terminateWorkers();
    logUpdate(`Probe failed: ${error.message}`);
    onError(error);
  };

  const controller: DeviceProfileProbeController = {
    // Cancels GPU and CPU work without reporting an error.
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutId);
      abortController.abort();
      terminateWorkers();
    },
  };

  // Adds browser and server matching results to a completed fractal analysis.
  const finalize = (quantumAnalysis: QuantumLandscapeResult) => {
    void finaliseWithFingerprint(quantumAnalysis, width, height, audioAllowed, logUpdate)
      .then(complete)
      .catch((error: unknown) => {
        fail(error instanceof Error ? error : new Error(String(error)));
      });
  };

  // Converts a backend matrix into the common result model.
  const finalizeMatrix = (
    matrix: Float32Array,
    backend: FractalBackend,
    durationMs: number,
    gpuStability?: GpuFractalStability,
  ) => {
    finalize({
      ...translateToQuantumPotential(matrix, width, height),
      fractalBackend: backend,
      fractalDurationMs: durationMs,
      gpuStability,
    });
  };

  // Runs the original tiled CPU implementation when WebGPU cannot be used.
  const startWorkerFallback = () => {
    if (settled) return;
    const startedAt = performance.now();

    if (typeof Worker === 'undefined') {
      logUpdate('Web Workers are unavailable. Using a deterministic main-thread fallback.');
      const mockMatrix = new Float32Array(width * height);
      for (let i = 0; i < mockMatrix.length; i++) {
        mockMatrix[i] = Math.sin(i * 0.01) * 0.5 + 0.5;
      }

      finalizeMatrix(mockMatrix, 'cpu-main', performance.now() - startedAt);
      return;
    }

    const hardwareCores = navigator.hardwareConcurrency || 2;
    const threadCount = Math.min(hardwareCores, 2);
    logUpdate(`Starting ${threadCount} CPU workers...`);

    const finalMatrix = new Float32Array(width * height);
    const chunkSize = Math.floor(height / threadCount);
    const jobId = Date.now();

    for (let i = 0; i < threadCount; i++) {
      try {
        const worker = new Worker(new URL('../workers/errorWorker.ts', import.meta.url));
        workers.add(worker);

        const startY = i * chunkSize;
        const endY = i === threadCount - 1 ? height : (i + 1) * chunkSize;

        worker.onmessage = (event: MessageEvent<WorkerOutbound>) => {
          const message = event.data;
          if (settled || message.jobId !== jobId) return;

          if (message.type === 'pws:error') {
            fail(new Error(message.message));
            return;
          }

          if (completedWorkers.has(worker)) return;

          const offset = message.startY * width;
          if (
            message.startY < 0 ||
            offset + message.errorChunk.length > finalMatrix.length ||
            message.errorChunk.length % width !== 0
          ) {
            fail(new Error(`Worker ${i} returned an invalid tile.`));
            return;
          }

          finalMatrix.set(message.errorChunk, offset);
          completedWorkers.add(worker);

          if (completedWorkers.size === threadCount) {
            logUpdate('All CPU worker tiles completed. Building the profile...');
            terminateWorkers();
            finalizeMatrix(finalMatrix, 'cpu-worker', performance.now() - startedAt);
          }
        };

        worker.onerror = (event) => {
          fail(new Error(`Worker ${i} crashed: ${event.message || 'unknown error'}`));
        };

        worker.postMessage({
          type: 'pws:tile-request',
          jobId,
          width,
          startY,
          endY,
          totalHeight: height,
          zoom,
        });
      } catch (error: unknown) {
        fail(error instanceof Error ? error : new Error(String(error)));
        break;
      }
    }
  };

  // Prefers WebGPU and falls back only for non-cancellation failures.
  const startProbe = async () => {
    logUpdate('Initializing synthetic device-profile probe...');

    if (navigator.gpu) {
      try {
        const gpuResult = await runGpuFractalProbe({
          width,
          height,
          zoom,
          stabilityTest: gpuStabilityEnabled,
          signal: abortController.signal,
          onStatus: logUpdate,
        });
        if (settled) return;
        logUpdate(`WebGPU fractal completed in ${gpuResult.durationMs.toFixed(1)} ms.`);
        finalizeMatrix(gpuResult.grid, 'webgpu', gpuResult.durationMs, gpuResult.stability);
        return;
      } catch (error: unknown) {
        if (settled) return;
        if (error instanceof DOMException && error.name === 'AbortError') {
          fail(error);
          return;
        }
        const message = error instanceof Error ? error.message : String(error);
        logUpdate(`WebGPU fractal unavailable: ${message}`);
      }
    } else {
      logUpdate('WebGPU is unavailable. Using the CPU fractal fallback.');
    }

    startWorkerFallback();
  };

  void startProbe().catch((error: unknown) => {
    fail(error instanceof Error ? error : new Error(String(error)));
  });

  return controller;
}

/** Builds the browser profile and requests a persistent server-side device match. */
async function finaliseWithFingerprint(
  quantumAnalysis: QuantumLandscapeResult,
  width: number,
  height: number,
  audioAllowed: boolean,
  logUpdate: (msg: string) => void,
): Promise<QuantumLandscapeResult> {
  try {
    logUpdate('Collecting browser and device-profile signals...');

    const fingerprint = await computeDeviceFingerprint({
      potentialGrid: quantumAnalysis.potentialGrid,
      width,
      height,
      audioAllowed,
    });

    for (const warning of fingerprint.warnings) {
      logUpdate(`Optional probe unavailable: ${warning}`);
    }

    try {
      logUpdate('Submitting normalized observation to the device matcher...');
      const match = await registerDeviceObservation(fingerprint.observation);
      logUpdate(
        match.matched
          ? `Matched an existing device cluster with ${(match.confidence * 100).toFixed(1)}% confidence.`
          : 'Created a new server-side device cluster.',
      );

      return {
        ...quantumAnalysis,
        browserProfileId: fingerprint.id,
        browserProfileCanonical: fingerprint.canonical,
        deviceClusterId: match.deviceClusterId,
        deviceMatchConfidence: match.confidence,
        deviceMatchEvidence: match.evidence,
        matchedExistingDevice: match.matched,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logUpdate(`Device matcher unavailable: ${message}`);
      return {
        ...quantumAnalysis,
        browserProfileId: fingerprint.id,
        browserProfileCanonical: fingerprint.canonical,
        deviceMatchError: message,
      };
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logUpdate(`Composite fingerprint unavailable: ${message}`);
    return {
      ...quantumAnalysis,
      deviceMatchError: message,
    };
  }
}

/** Produces a small non-cryptographic fallback identifier for a grid. */
export function generateGridHash(matrix: Float32Array): string {
  let hash = 0;
  for (let i = 0; i < matrix.length; i++) {
    hash = (hash << 5) - hash + matrix[i];
    hash |= 0;
  }
  return 'GRID-SIG-' + Math.abs(hash).toString(16).toUpperCase();
}

/** Produces a SHA-256 fallback identifier when Web Crypto is available. */
export async function generateGridHash256(matrix: Float32Array): Promise<string> {
  const targetSource = matrix as BufferSource;
  const hashBuffer = await crypto.subtle.digest('SHA-256', targetSource);
  const hashArray = new Uint8Array(hashBuffer);
  const hexString = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  return `GRID-SHA256-${hexString}`;
}

/** Summarizes finite non-zero grid values and counts invalid entries. */
export function analyzeMatrixVariance(matrix: Float32Array): MatrixVarianceAnalysis {
  let activeGlitches = 0;
  let totalErrorMagnitude = 0;
  let invalidValues = 0;

  for (let i = 0; i < matrix.length; i++) {
    if (!Number.isFinite(matrix[i])) {
      invalidValues++;
      continue;
    }
    if (matrix[i] > 0.0) {
      activeGlitches++;
      totalErrorMagnitude += matrix[i];
    }
  }

  return {
    activeGlitches,
    averageDrift:
      matrix.length > invalidValues ? totalErrorMagnitude / (matrix.length - invalidValues) : NaN,
    invalidValues,
  };
}
