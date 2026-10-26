import type { GridFeatures } from './features';
import type { CpuTimingSignals } from './probes/cpu';
import type { WebGLSignals } from './probes/webgl';
import type { WebGPUSignals } from './probes/webgpu';

export interface UserAgentSignals {
  platform: string;
  architecture: string;
  bitness: string;
  mobile: boolean;
}

export interface NormalizedGpuDescriptor {
  vendor: string;
  model: string;
  backend: string;
}

export interface DeviceObservation {
  schemaVersion: 1;
  capturedAt: string;
  platform: string;
  architecture: string;
  bitness: string;
  mobile: boolean;
  availability: {
    webgl: boolean;
    webgpu: boolean;
  };
  cpu: {
    logicalCores: number;
    memoryGiB: number;
    timingRatios: number[];
    timingDispersion: number;
  };
  graphics: {
    descriptor: NormalizedGpuDescriptor;
    webglLimits: Record<string, number>;
    webgpuLimits: Record<string, number>;
    matrix: WebGPUSignals['matrix'] | null;
    webglTimingRatios: number[];
    webglTimingDispersion: number;
    webgpuTimingRatios: number[];
    webgpuTimingDispersion: number;
  };
  syntheticGrid: {
    entropy: number;
    mean: number;
    variance: number;
    shape: string;
  };
}

export interface DeviceMatchResult {
  deviceClusterId: string;
  confidence: number;
  evidence: number;
  matched: boolean;
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[(),:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePlatform(platform: string): string {
  const value = normalizeText(platform);
  if (/iphone|ipad|ios/.test(value)) return 'ios';
  if (/mac/.test(value)) return 'macos';
  if (/win/.test(value)) return 'windows';
  if (/android/.test(value)) return 'android';
  if (/linux|x11/.test(value)) return 'linux';
  return value || 'unknown';
}

export function normalizeArchitecture(architecture: string): string {
  const value = normalizeText(architecture);
  if (/arm64|aarch64/.test(value)) return 'arm64';
  if (/arm/.test(value)) return 'arm';
  if (/x86_64|x64|amd64/.test(value)) return 'x64';
  if (/x86|i[3-6]86/.test(value)) return 'x86';
  return value || 'unknown';
}

function detectGpuVendor(value: string): string {
  if (/nvidia|geforce|quadro/.test(value)) return 'nvidia';
  if (/amd|radeon|ati/.test(value)) return 'amd';
  if (/intel/.test(value)) return 'intel';
  if (/apple/.test(value)) return 'apple';
  if (/qualcomm|adreno/.test(value)) return 'qualcomm';
  if (/arm|mali/.test(value)) return 'arm';
  if (/imagination|powervr/.test(value)) return 'imagination';
  if (/microsoft basic|swiftshader|llvmpipe/.test(value)) return 'software';
  return 'unknown';
}

function detectBackend(value: string): string {
  if (/direct3d\s*12|d3d12/.test(value)) return 'd3d12';
  if (/direct3d\s*11|d3d11/.test(value)) return 'd3d11';
  if (/metal/.test(value)) return 'metal';
  if (/vulkan/.test(value)) return 'vulkan';
  if (/opengl/.test(value)) return 'opengl';
  return 'unknown';
}

function normalizeGpuModel(value: string, vendor: string): string {
  return normalizeText(value)
    .replace(/^angle\s+/, '')
    .replace(/angle metal renderer/g, '')
    .replace(/direct3d\s*\d+.*/g, '')
    .replace(/d3d\d+.*/g, '')
    .replace(/vulkan.*/g, '')
    .replace(/opengl engine/g, '')
    .replace(/unspecified version/g, '')
    .replace(/vs_\d+_\d+|ps_\d+_\d+/g, '')
    .replace(new RegExp(`\\b${vendor}\\b`, 'g'), '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeGpuDescriptor(
  webgl: WebGLSignals | null,
  webgpu: WebGPUSignals | null,
): NormalizedGpuDescriptor {
  const source = [
    webgpu?.adapter.vendor,
    webgpu?.adapter.architecture,
    webgpu?.adapter.device,
    webgpu?.adapter.description,
    webgl?.vendor,
    webgl?.renderer,
  ]
    .filter(Boolean)
    .join(' ');
  const normalized = normalizeText(source);
  const vendor = detectGpuVendor(normalized);
  const modelSource =
    webgl?.renderer ||
    webgpu?.adapter.description ||
    webgpu?.adapter.device ||
    webgpu?.adapter.architecture ||
    '';

  return {
    vendor,
    model: normalizeGpuModel(modelSource, vendor) || 'unknown',
    backend: detectBackend(normalized),
  };
}

function finite(value: number, digits = 6): number {
  if (!Number.isFinite(value)) return 0;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function finiteVector(values: number[], digits = 6): number[] {
  return values.map((value) => finite(value, digits));
}

export function createDeviceObservation(inputs: {
  gridFeatures: GridFeatures;
  webgl: WebGLSignals | null;
  webgpu: WebGPUSignals | null;
  cpuTiming: CpuTimingSignals | null;
  ua: UserAgentSignals;
}): DeviceObservation {
  const navigatorWithMemory = navigator as Navigator & { deviceMemory?: number };

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    platform: normalizePlatform(inputs.ua.platform || navigator.platform),
    architecture: normalizeArchitecture(inputs.ua.architecture),
    bitness: inputs.ua.bitness || 'unknown',
    mobile: inputs.ua.mobile,
    availability: {
      webgl: inputs.webgl !== null,
      webgpu: inputs.webgpu !== null,
    },
    cpu: {
      logicalCores: navigator.hardwareConcurrency || 0,
      memoryGiB: navigatorWithMemory.deviceMemory || 0,
      timingRatios: finiteVector(inputs.cpuTiming?.ratios ?? []),
      timingDispersion: finite(inputs.cpuTiming?.dispersion ?? 1),
    },
    graphics: {
      descriptor: normalizeGpuDescriptor(inputs.webgl, inputs.webgpu),
      webglLimits: inputs.webgl?.limits ?? {},
      webgpuLimits: inputs.webgpu?.adapter.limits ?? {},
      matrix: inputs.webgpu?.matrix ?? null,
      webglTimingRatios: finiteVector(inputs.webgl?.timing.ratios ?? []),
      webglTimingDispersion: finite(inputs.webgl?.timing.dispersion ?? 1),
      webgpuTimingRatios: finiteVector(inputs.webgpu?.timing.ratios ?? []),
      webgpuTimingDispersion: finite(inputs.webgpu?.timing.dispersion ?? 1),
    },
    syntheticGrid: {
      entropy: finite(inputs.gridFeatures.entropy),
      mean: finite(inputs.gridFeatures.mean),
      variance: finite(inputs.gridFeatures.variance),
      shape: inputs.gridFeatures.quantizedFingerprint,
    },
  };
}
