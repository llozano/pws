// fingerprint/aggregate.ts
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

function round(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return 0;
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

export async function buildFingerprint(inputs: FingerprintInputs): Promise<{
  id: string; // Browser-scoped full fingerprint
  hardwareId: string; // Cross-browser pure hardware fingerprint
  canonical: string;
}> {
  // 1. Pure Hardware Canonical State (No browser-dependent canvas/audio/UA signals)
  const hardwareCanonical = JSON.stringify({
    v: 1,
    grid: {
      quantizedFingerprint: inputs.gridFeatures.quantizedFingerprint,
      variance: round(inputs.gridFeatures.variance, 2),
      entropy: round(inputs.gridFeatures.entropy, 2),
      gradMean: round(inputs.gridFeatures.gradMean, 2),
    },
    webgpu: inputs.webgpu && {
      adapter: {
        vendor: inputs.webgpu.adapter.vendor,
        architecture: inputs.webgpu.adapter.architecture,
        device: inputs.webgpu.adapter.device,
      },
      matrixHash: inputs.webgpu.matrixHash,
    },
  });

  // 2. Full Browser-Scoped Canonical State (Your existing comprehensive profile)
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
      extensions: inputs.webgl.extensions,
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
    },
    canvas: inputs.canvasHash,
    audio: inputs.audioHash,
    ua: inputs.uaData,
    screen: inputs.screenHash,
  });

  const id = await sha256Hex(canonical);
  const hardwareId = await sha256Hex(hardwareCanonical);

  return { id, hardwareId, canonical };
}
