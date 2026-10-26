import { sha256Hex } from './hash';
import type { GridFeatures } from './features';
import type { WebGLSignals } from './probes/webgl';
import type { WebGPUSignals } from './probes/webgpu';
import type { CpuTimingSignals } from './probes/cpu';
import {
  createDeviceObservation,
  type DeviceObservation,
  type UserAgentSignals,
} from './observation';

export interface FingerprintInputs {
  gridFeatures: GridFeatures;
  webgl: WebGLSignals | null;
  webgpu: WebGPUSignals | null;
  canvasHash: string;
  audioHash: string;
  cpuTiming: CpuTimingSignals | null;
  uaData: UserAgentSignals;
  screenHash?: string;
}

function round(n: number, digits = 4): number {
  if (!Number.isFinite(n)) return 0;
  const m = Math.pow(10, digits);
  return Math.round(n * m) / m;
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

export async function buildFingerprint(inputs: FingerprintInputs): Promise<{
  id: string;
  canonical: string;
  observation: DeviceObservation;
}> {
  const canonical = JSON.stringify({
    v: 4,
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
      limits: sortedRecord(inputs.webgl.limits),
      precision: sortedRecord(inputs.webgl.precision),
      shaderHash: inputs.webgl.shaderHash,
    },
    webgpu: inputs.webgpu && {
      adapter: {
        vendor: inputs.webgpu.adapter.vendor,
        architecture: inputs.webgpu.adapter.architecture,
        device: inputs.webgpu.adapter.device,
        description: inputs.webgpu.adapter.description,
        features: inputs.webgpu.adapter.features,
        limits: sortedRecord(inputs.webgpu.adapter.limits),
      },
      matrix: {
        mean: round(inputs.webgpu.matrix.mean, 6),
        variance: round(inputs.webgpu.matrix.variance, 6),
        min: round(inputs.webgpu.matrix.min, 6),
        max: round(inputs.webgpu.matrix.max, 6),
        quantized: inputs.webgpu.matrix.quantized,
      },
    },
    canvas: inputs.canvasHash,
    audio: inputs.audioHash,
    ua: inputs.uaData,
    screen: inputs.screenHash,
  });

  const id = await sha256Hex(canonical);
  const observation = createDeviceObservation({
    gridFeatures: inputs.gridFeatures,
    webgl: inputs.webgl,
    webgpu: inputs.webgpu,
    cpuTiming: inputs.cpuTiming,
    ua: inputs.uaData,
  });

  return { id, canonical, observation };
}
