export interface CpuTimingSignals {
  ratios: number[];
  dispersion: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function relativeDispersion(values: number[], center: number): number {
  if (center <= 0) return 1;
  return median(values.map((value) => Math.abs(value - center))) / center;
}

function measure(workload: () => number): { duration: number; dispersion: number } {
  workload();
  workload();

  const samples: number[] = [];
  let sink = 0;
  for (let sample = 0; sample < 7; sample++) {
    const startedAt = performance.now();
    sink += workload();
    samples.push(performance.now() - startedAt);
  }
  if (!Number.isFinite(sink)) throw new Error('CPU timing workload produced an invalid result.');

  const duration = median(samples);
  return {
    duration,
    dispersion: relativeDispersion(samples, duration),
  };
}

function integerWorkload(): number {
  let value = 0x9e3779b9;
  for (let i = 0; i < 600_000; i++) {
    value = Math.imul(value ^ i, 0x85ebca6b);
    value = (value << 13) | (value >>> 19);
  }
  return value;
}

function floatingPointWorkload(): number {
  let value = 0.125;
  for (let i = 1; i < 180_000; i++) {
    value += Math.sin(value + i * 0.0001) * Math.cos(i * 0.00003);
  }
  return value;
}

function memoryWorkload(): number {
  const values = new Float64Array(32_768);
  let sum = 0;
  for (let pass = 0; pass < 12; pass++) {
    for (let i = 0; i < values.length; i++) {
      values[i] = values[i] * 0.75 + ((i + pass) % 97);
      sum += values[i];
    }
  }
  return sum;
}

export function collectCpuTimingSignals(): CpuTimingSignals {
  const measurements = [
    measure(integerWorkload),
    measure(floatingPointWorkload),
    measure(memoryWorkload),
  ];
  const baseline = measurements[0].duration || 1;

  return {
    ratios: measurements.map(({ duration }) => duration / baseline),
    dispersion:
      measurements.reduce((total, measurement) => total + measurement.dispersion, 0) /
      measurements.length,
  };
}
