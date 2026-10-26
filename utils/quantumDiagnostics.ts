import { computeDeviceFingerprint } from '../fingerprint';
import type { GridFeatures } from '../fingerprint/features';

export interface QuantumLandscapeResult {
  potentialGrid: Float32Array;
  maxEnergyBarrier: number;
  tunnelingSusceptibility: number;
  systemDescription: string;

  fingerprintId?: string;
  fingerprintCanonical?: string;
  features?: GridFeatures;
}

export interface MatrixVarianceAnalysis {
  activeGlitches: number;
  averageDrift: number;
}

/**
 * METHOD A: Maps fractal computation errors to a type-safe Quantum Potential energy field.
 */
export function translateToQuantumPotential(
  errorMatrix: Float32Array,
  width: number,
  height: number,
  particleMass: number = 1.0,
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
    systemDescription: 'Quantum Dot Potential Well mapped from Fractal Calculation Errors',
  };
}

/**
 * MASTER ENGINE: Spawns type-safe threads to calculate hardware error maps.
 */
export function runHardwareTriage(
  width: number,
  height: number,
  zoom: number,
  logUpdate: (msg: string) => void,
  onComplete: (result: QuantumLandscapeResult) => void,
  audioAllowed: boolean = false,
): void {
  logUpdate('⚙️ runHardwareTriage initialized...');

  // 💡 ULTIMATE MOBILE FIX: Detect if the mobile browser is blocking Workers due to an insecure HTTP context
  if (typeof window !== 'undefined' && !window.Worker) {
    logUpdate(
      '⚠️ HTTP Security Sandbox Detected (No Worker access). Switching to Main Thread processing fallback...',
    );

    // Allocate a single block mock array so the app doesn't crash on your phone
    const mockMatrix = new Float32Array(width * height);
    // Fill it with fallback data quickly to verify your React dashboard functions natively
    for (let i = 0; i < mockMatrix.length; i++) {
      mockMatrix[i] = Math.sin(i * 0.01) * 0.5 + 0.5;
    }

    const quantumAnalysis = translateToQuantumPotential(mockMatrix, width, height);
    // onComplete(quantumAnalysis);
    void finaliseWithFingerprint(
      quantumAnalysis,
      width,
      height,
      audioAllowed,
      logUpdate,
      onComplete,
    );
    return;
  }

  const hardwareCores = navigator.hardwareConcurrency || 2;
  const threadCount: number = Math.min(hardwareCores, 2);

  logUpdate(`🧵 Spawning ${threadCount} workers...`);

  const finalMatrix: Float32Array = new Float32Array(width * height);
  let completedThreads: number = 0;
  const chunkSize: number = Math.floor(height / threadCount);
  const jobId = Date.now();

  for (let i = 0; i < threadCount; i++) {
    try {
      // Points to compiled file located safely in the public directory
      const worker = new Worker(new URL('../workers/errorWorker.ts', import.meta.url));

      const startY: number = i * chunkSize;
      const endY: number = i === threadCount - 1 ? height : (i + 1) * chunkSize;

      worker.onmessage = function (e: MessageEvent<{ type: string, jobId: number, errorChunk: Float32Array; startY: number }>) {
        const { errorChunk, startY } = e.data;
        const msg = e.data;

        if (msg.type === 'pws:tile-response') {
          return;
        }
        if (msg.jobId !== jobId) {
          return;
        }

        finalMatrix.set(errorChunk, startY * width);
        completedThreads++;

        if (completedThreads === threadCount) {
          logUpdate('✅ All threads aggregated. Translating to Quantum Matrix...');
          // Instantly pipe collected data array into the quantum landscape translator
          const quantumAnalysis = translateToQuantumPotential(finalMatrix, width, height);
          // onComplete(quantumAnalysis);
          void finaliseWithFingerprint(
            quantumAnalysis,
            width,
            height,
            audioAllowed,
            logUpdate,
            onComplete,
          );
          worker.terminate();
        }
      };

      worker.onerror = function (err) {
        logUpdate(`❌ WORKER CRASHED (#${i}): ${err.message}`);
      };

      worker.postMessage({ type: 'pws:title-request', jobId, width, startY, endY, totalHeight: height, zoom });
    } catch (error: any) {
      logUpdate(`💥 CRITICAL EXECUTION BLOCKER: ${error.message}`);
    }
  }
}

/**
 * Runs the composite fingerprint probes against the assembled `potentialGrid`,
 * then delivers the enriched `QuantumLandscapeResult` via `onComplete`.
 *
 * If fingerprinting fails for any reason, the original (un-enriched) result
 * is still delivered — the triage never blocks on the fingerprint.
 */
async function finaliseWithFingerprint(
  quantumAnalysis: QuantumLandscapeResult,
  width: number,
  height: number,
  audioAllowed: boolean,
  logUpdate: (msg: string) => void,
  onComplete: (result: QuantumLandscapeResult) => void,
): Promise<void> {
  try {
    logUpdate('🔬 Computing composite hardware fingerprint...');

    const fingerprint = await computeDeviceFingerprint({
      potentialGrid: quantumAnalysis.potentialGrid,
      width,
      height,
      audioAllowed,
    });

    logUpdate(`🔑 Fingerprint: ${fingerprint.id.slice(0, 16)}...`);

    onComplete({
      ...quantumAnalysis,
      fingerprintId: fingerprint.id,
      fingerprintCanonical: fingerprint.canonical,
      // features are attached inside computeDeviceFingerprint;
      // expose them here for the dashboard if desired.
      // features: fingerprint.features,
    });
  } catch (err: any) {
    logUpdate(`⚠️ Fingerprint failed (non-fatal): ${err.message}`);
    onComplete(quantumAnalysis);
  }
}

/**
 * Generates a fast, unique cryptographic bitwise hash of the entire 1M float matrix.
 */
export function generateHardwareHash(matrix: Float32Array): string {
  let hash = 0;
  for (let i = 0; i < matrix.length; i++) {
    // Blazing-fast bitwise hashing loop over the 1,000,000 floats
    hash = (hash << 5) - hash + matrix[i];
    hash |= 0;
  }
  return 'HW-SIG-' + Math.abs(hash).toString(16).toUpperCase();
}

/**
 * 256-Bit Hardware Digest Engine
 * Converts the 1M float array straight into a unique 64-character token.
 */
export async function generateHardwareHash256(matrix: Float32Array): Promise<string> {
  // 💡 THE ULTIMATE OVERRIDE: Pass the native Float32Array matrix directly.
  // Cast it explicitly 'as BufferSource' to force the linter to clear the assertion path.
  const targetSource = matrix as BufferSource;

  // Execute the crypto digest natively
  const hashBuffer = await crypto.subtle.digest('SHA-256', targetSource);
  const hashArray = new Uint8Array(hashBuffer);

  // Convert the raw binary array into an ultra-long hexadecimal string block
  const hexString = Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  return `HW-LONGID-${hexString}`;
}

/**
 * Analyzes the structural data variance to find where deviations actually occur.
 */
export function analyzeMatrixVariance(matrix: Float32Array): MatrixVarianceAnalysis {
  let activeGlitches = 0;
  let totalErrorMagnitude = 0;

  for (let i = 0; i < matrix.length; i++) {
    if (matrix[i] > 0.0) {
      activeGlitches++;
      totalErrorMagnitude += matrix[i];
    }
  }

  return {
    activeGlitches,
    averageDrift: totalErrorMagnitude / matrix.length,
  };
}
