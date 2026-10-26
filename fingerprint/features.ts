export interface GridFeatures {
  mean: number;
  variance: number;
  skew: number;
  kurtosis: number;
  min: number;
  max: number;
  entropy: number; // Shannon entropy of a 256-bin histogram
  gradMean: number; // mean |∂x| + |∂y|
  gradVar: number;
  crossCorr: number; // corr(g, shifted(g, 1))
  quantizedFingerprint: string; // coarse bucketed values (robust, still unique)
}

export function extractGridFeatures(
  grid: Float32Array,
  width: number,
  height: number,
): GridFeatures {
  const n = grid.length;
  let min = Infinity,
    max = -Infinity,
    sum = 0;
  for (let i = 0; i < n; i++) {
    const v = grid[i];
    if (v < min) min = v;
    if (v > max) max = v;
    sum += v;
  }
  const mean = sum / n;

  let m2 = 0,
    m3 = 0,
    m4 = 0;
  for (let i = 0; i < n; i++) {
    const d = grid[i] - mean;
    m2 += d * d;
    m3 += d * d * d;
    m4 += d * d * d * d;
  }
  m2 /= n;
  m3 /= n;
  m4 /= n;
  const variance = m2;
  const std = Math.sqrt(variance) || 1e-12;
  const skew = m3 / (std * std * std);
  const kurtosis = m4 / (std * std * std * std) - 3;

  // histogram entropy
  const bins = new Uint32Array(256);
  const span = max - min || 1;
  for (let i = 0; i < n; i++) {
    const b = Math.min(255, Math.max(0, Math.floor(((grid[i] - min) / span) * 255)));
    bins[b]++;
  }
  let H = 0;
  for (let b = 0; b < 256; b++) {
    if (!bins[b]) continue;
    const p = bins[b] / n;
    H -= p * Math.log2(p);
  }

  // gradient statistics
  let gs = 0,
    gs2 = 0,
    cnt = 0,
    cc = 0;
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = y * width + x;
      const dx = grid[i + 1] - grid[i];
      const dy = grid[i + width] - grid[i];
      const g = Math.abs(dx) + Math.abs(dy);
      gs += g;
      gs2 += g * g;
      cnt++;
      cc += (grid[i] - mean) * (grid[i + 1] - mean);
    }
  }
  const gradMean = gs / cnt;
  const gradVar = gs2 / cnt - gradMean * gradMean;
  const crossCorr = cc / n / variance;

  // Coarse bucketed signature: quantize to 8 buckets and keep first 64
  // values as a string — reflects *shape* of errors, robust to tiny jitter.
  let q = '';
  for (let i = 0; i < Math.min(64, n); i++) {
    q += String(Math.min(7, Math.max(0, Math.floor(((grid[i] - min) / span) * 8))));
  }

  return {
    mean,
    variance,
    skew,
    kurtosis,
    min,
    max,
    entropy: H,
    gradMean,
    gradVar,
    crossCorr,
    quantizedFingerprint: q,
  };
}
