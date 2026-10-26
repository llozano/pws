import type { DeviceObservation } from '@/fingerprint/observation';

function record(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, name: string, maxLength = 256): string {
  if (typeof value !== 'string' || value.length > maxLength) {
    throw new Error(`${name} must be a string no longer than ${maxLength} characters.`);
  }
  return value;
}

function number(value: unknown, name: string, maximum = 1e12): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > maximum) {
    throw new Error(`${name} must be a finite number.`);
  }
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean.`);
  return value;
}

function numberArray(value: unknown, name: string, maxLength = 64): number[] {
  if (!Array.isArray(value) || value.length > maxLength) {
    throw new Error(`${name} must be an array with at most ${maxLength} entries.`);
  }
  return value.map((entry, index) => number(entry, `${name}[${index}]`, 1e6));
}

function numberRecord(value: unknown, name: string): Record<string, number> {
  const input = record(value, name);
  const entries = Object.entries(input);
  if (entries.length > 128) throw new Error(`${name} has too many entries.`);
  return Object.fromEntries(
    entries.map(([key, entry]) => [text(key, `${name} key`, 80), number(entry, `${name}.${key}`)]),
  );
}

export function parseDeviceObservation(value: unknown): DeviceObservation {
  const input = record(value, 'observation');
  if (input.schemaVersion !== 1) throw new Error('Unsupported observation schema version.');

  const availability = record(input.availability, 'availability');
  const cpu = record(input.cpu, 'cpu');
  const graphics = record(input.graphics, 'graphics');
  const descriptor = record(graphics.descriptor, 'graphics.descriptor');
  const grid = record(input.syntheticGrid, 'syntheticGrid');
  const matrixInput = graphics.matrix === null ? null : record(graphics.matrix, 'graphics.matrix');

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    platform: text(input.platform, 'platform', 40),
    architecture: text(input.architecture, 'architecture', 40),
    bitness: text(input.bitness, 'bitness', 20),
    mobile: boolean(input.mobile, 'mobile'),
    availability: {
      webgl: boolean(availability.webgl, 'availability.webgl'),
      webgpu: boolean(availability.webgpu, 'availability.webgpu'),
    },
    cpu: {
      logicalCores: number(cpu.logicalCores, 'cpu.logicalCores', 1_024),
      memoryGiB: number(cpu.memoryGiB, 'cpu.memoryGiB', 1_024),
      timingRatios: numberArray(cpu.timingRatios, 'cpu.timingRatios'),
      timingDispersion: number(cpu.timingDispersion, 'cpu.timingDispersion', 100),
    },
    graphics: {
      descriptor: {
        vendor: text(descriptor.vendor, 'graphics.descriptor.vendor', 80),
        model: text(descriptor.model, 'graphics.descriptor.model', 256),
        backend: text(descriptor.backend, 'graphics.descriptor.backend', 40),
      },
      webglLimits: numberRecord(graphics.webglLimits, 'graphics.webglLimits'),
      webgpuLimits: numberRecord(graphics.webgpuLimits, 'graphics.webgpuLimits'),
      matrix:
        matrixInput === null
          ? null
          : {
              mean: number(matrixInput.mean, 'graphics.matrix.mean'),
              variance: number(matrixInput.variance, 'graphics.matrix.variance'),
              min: number(matrixInput.min, 'graphics.matrix.min'),
              max: number(matrixInput.max, 'graphics.matrix.max'),
              quantized: text(matrixInput.quantized, 'graphics.matrix.quantized', 512),
            },
      webglTimingRatios: numberArray(graphics.webglTimingRatios, 'graphics.webglTimingRatios'),
      webglTimingDispersion: number(
        graphics.webglTimingDispersion,
        'graphics.webglTimingDispersion',
        100,
      ),
      webgpuTimingRatios: numberArray(graphics.webgpuTimingRatios, 'graphics.webgpuTimingRatios'),
      webgpuTimingDispersion: number(
        graphics.webgpuTimingDispersion,
        'graphics.webgpuTimingDispersion',
        100,
      ),
    },
    syntheticGrid: {
      entropy: number(grid.entropy, 'syntheticGrid.entropy', 100),
      mean: number(grid.mean, 'syntheticGrid.mean'),
      variance: number(grid.variance, 'syntheticGrid.variance'),
      shape: text(grid.shape, 'syntheticGrid.shape', 256),
    },
  };
}
