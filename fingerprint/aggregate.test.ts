import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildFingerprint } from './aggregate';
import type { FingerprintInputs } from './aggregate';

const inputs: FingerprintInputs = {
  gridFeatures: {
    mean: 1,
    variance: 2,
    skew: 0.1,
    kurtosis: 0.2,
    min: 0,
    max: 4,
    entropy: 3.4,
    gradMean: 0.5,
    gradVar: 0.25,
    crossCorr: 0.75,
    quantizedFingerprint: '01234567',
  },
  webgl: null,
  webgpu: {
    adapter: {
      vendor: 'vendor',
      architecture: 'architecture',
      device: 'device',
      description: 'description',
      features: ['feature-b', 'feature-a'],
      limits: { zLimit: 2, aLimit: 1 },
    },
    matrix: {
      mean: 0.5,
      variance: 0.25,
      min: -1,
      max: 1,
      quantized: '0 1 2 3',
    },
    timing: {
      ratios: [1, 2.34567],
      dispersion: 0.01234,
    },
  },
  canvasHash: 'canvas',
  audioHash: 'audio',
  cpuTiming: {
    ratios: [1, 1.2, 0.8],
    dispersion: 0.02,
  },
  uaData: {
    platform: 'macOS',
    architecture: 'arm64',
    bitness: '64',
    mobile: false,
  },
};

describe('buildFingerprint', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps browser-specific values in the browser profile and emits an observation', async () => {
    vi.stubGlobal('navigator', {
      hardwareConcurrency: 8,
      deviceMemory: 16,
      platform: 'MacIntel',
    });

    const result = await buildFingerprint(inputs);
    const canonical = JSON.parse(result.canonical);

    expect(canonical.webgpu.matrix.mean).toBe(0.5);
    expect(canonical.webgpu.timing).toBeUndefined();
    expect(canonical.cpuTiming).toBeUndefined();
    expect(Object.keys(canonical.webgpu.adapter.limits)).toEqual(['aLimit', 'zLimit']);
    expect(result.observation.schemaVersion).toBe(1);
    expect(result.observation.cpu.logicalCores).toBe(8);
    expect(result.observation.platform).toBe('macos');
    expect(result.id).toHaveLength(64);
  });
});
