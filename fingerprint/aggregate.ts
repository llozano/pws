import { sha256Hex } from './hash';
import { GridFeatures } from './features';
import { WebGLSignals } from './probes/webgl';
import { WebGPUSignals } from './probes/webgpu';

export interface FingerprintInputs {
  gridFeatures: GridFeatures;
  webgl: WebGLSignals | null;
  webgpu: WebGPUSignals | null;
  canvasHash: string;
  audioHash: string;
  uaData?: { platform?: string; arch?: string; bitness?: string; mobile?: boolean };
  screenHash?: string;
}

/**
 * Canonicalize floats so tiny nondeterminism on probes doesn't destroy
 * stability but real differences survive. `digits` controls precision.
 */
function round(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return 0;
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

export async function buildFingerprint(inputs: FingerprintInputs): Promise<{
  id: string;
  canonical: string;
}> {
  const canonical = JSON.stringify({
    v: 2,
    grid: {
      ...inputs.gridFeatures,
      mean: round(inputs.gridFeatures.mean, 6),
      variance: round(inputs.gridFeatures.variance, 6),
      skew: round(inputs.gridFeatures.skew, 4),
      kurtosis: round(inputs.gridFeatures.kurtosis, 4),
      entropy: round(inputs.gridFeatures.entropy, 4),
      gradMean: round(inputs.gridFeatures.gradMean, 4),
      gradVar: round(inputs.gridFeatures.gradVar, 4),
      crossCorr: round(inputs.gridFeatures.crossCorr, 4),
    },
    webgl: inputs.webgl && {
      renderer: inputs.webgl.renderer,
      vendor: inputs.webgl.vendor,
      version: inputs.webgl.version,
      extensions: inputs.webgl.extensions, // full sorted list
      limits: inputs.webgl.limits,
      precision: inputs.webgl.precision,
      shaderHash: inputs.webgl.shaderHash,
    },
    webgpu: inputs.webgpu && {
      adapter: {
        vendor: inputs.webgpu.adapter.vendor,
        architecture: inputs.webgpu.adapter.architecture,
        device: inputs.webgpu.adapter.device,
        description: inputs.webgpu.adapter.description,
        features: inputs.webgpu.adapter.features,
        limits: inputs.webgpu.adapter.limits,
      },
      matrixHash: inputs.webgpu.matrixHash,
      // atomicScaling: inputs.webgpu.atomicScaling.map((v) => round(v / (inputs.webgpu?.atomicScaling[0] || 1), 2)),
    },
    canvas: inputs.canvasHash,
    audio: inputs.audioHash,
    ua: inputs.uaData,
    screen: inputs.screenHash,
  });

  const id = await sha256Hex(canonical);
  return { id, canonical };
}
