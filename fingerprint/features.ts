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
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Grid dimensions must be positive integers.');
  }
  if (grid.length !== width * height) {
    throw new Error('Grid dimensions do not match the supplied data.');
  }

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
  const gradMean = cnt > 0 ? gs / cnt : 0;
  const gradVar = cnt > 0 ? Math.max(0, gs2 / cnt - gradMean * gradMean) : 0;
  const crossCorr = cnt > 0 && variance > 0 ? cc / cnt / variance : 0;

  let q = '';
  const sampleWidth = Math.min(8, width);
  const sampleHeight = Math.min(8, height);
  for (let sampleY = 0; sampleY < sampleHeight; sampleY++) {
    const y = sampleHeight === 1 ? 0 : Math.round((sampleY * (height - 1)) / (sampleHeight - 1));
    for (let sampleX = 0; sampleX < sampleWidth; sampleX++) {
      const x = sampleWidth === 1 ? 0 : Math.round((sampleX * (width - 1)) / (sampleWidth - 1));
      const value = grid[y * width + x];
      q += String(Math.min(7, Math.max(0, Math.floor(((value - min) / span) * 8))));
    }
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
