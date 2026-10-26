import { describe, expect, it } from 'vitest';
import type { DeviceObservation } from '@/fingerprint/observation';
import {
  compareDeviceObservations,
  findDeviceMatch,
  type StoredDeviceCluster,
} from './deviceMatcher';

function observation(
  overrides: Omit<Partial<DeviceObservation>, 'graphics'> & {
    graphics?: Partial<DeviceObservation['graphics']>;
  } = {},
): DeviceObservation {
  const { graphics: graphicsOverrides, ...observationOverrides } = overrides;
  const graphics: DeviceObservation['graphics'] = {
    descriptor: {
      vendor: 'apple',
      model: 'm2 pro',
      backend: 'metal',
    },
    webglLimits: {
      MAX_TEXTURE_SIZE: 16_384,
      MAX_RENDERBUFFER_SIZE: 16_384,
      MAX_VERTEX_ATTRIBS: 16,
    },
    webgpuLimits: {},
    matrix: null,
    webglTimingRatios: [1, 1.62, 2.91, 4.18],
    webglTimingDispersion: 0.03,
    webgpuTimingRatios: [],
    webgpuTimingDispersion: 1,
    ...graphicsOverrides,
  };

  return {
    schemaVersion: 1,
    capturedAt: '2025-01-01T00:00:00.000Z',
    platform: 'macos',
    architecture: 'arm64',
    bitness: '64',
    mobile: false,
    availability: {
      webgl: true,
      webgpu: false,
    },
    cpu: {
      logicalCores: 10,
      memoryGiB: 8,
      timingRatios: [1, 2.1, 0.85],
      timingDispersion: 0.04,
    },
    syntheticGrid: {
      entropy: 4,
      mean: 0.5,
      variance: 0.1,
      shape: '0123',
    },
    ...observationOverrides,
    graphics,
  };
}

function cluster(value: DeviceObservation): StoredDeviceCluster {
  return {
    id: 'cluster-1',
    createdAt: value.capturedAt,
    updatedAt: value.capturedAt,
    observations: [value],
  };
}

describe('device matcher', () => {
  it('matches noisy cross-browser observations when WebGPU is missing in one browser', () => {
    const first = observation();
    const second = observation({
      cpu: {
        logicalCores: 8,
        memoryGiB: 8,
        timingRatios: [1, 2.2, 0.9],
        timingDispersion: 0.06,
      },
      availability: {
        webgl: true,
        webgpu: true,
      },
      graphics: {
        descriptor: {
          vendor: 'apple',
          model: 'm2 pro',
          backend: 'metal',
        },
        webglTimingRatios: [1, 1.7, 2.8, 4.3],
        webgpuLimits: {
          maxTextureDimension2D: 16_384,
        },
        matrix: {
          mean: 0.01,
          variance: 0.2,
          min: -1,
          max: 1,
          quantized: '0 1 2 3',
        },
        webgpuTimingRatios: [1, 1.2, 1.5],
        webgpuTimingDispersion: 0.05,
      },
    });

    const match = findDeviceMatch(second, [cluster(first)]);

    expect(match).not.toBeNull();
    expect(match?.deviceClusterId).toBe('cluster-1');
    expect(match?.confidence).toBeGreaterThan(0.75);
  });

  it('rejects observations from different operating-system platforms', () => {
    const similarity = compareDeviceObservations(
      observation(),
      observation({ platform: 'windows', architecture: 'x64' }),
    );

    expect(similarity).toEqual({ score: 0, evidence: 1 });
  });

  it('does not merge different GPUs that otherwise expose similar limits', () => {
    const first = observation();
    const second = observation({
      graphics: {
        descriptor: {
          vendor: 'nvidia',
          model: 'geforce rtx 4070',
          backend: 'metal',
        },
      },
    });

    expect(findDeviceMatch(second, [cluster(first)])).toBeNull();
  });
});
