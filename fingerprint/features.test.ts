import { describe, expect, it } from 'vitest';
import { extractGridFeatures } from './features';

describe('extractGridFeatures', () => {
  it('returns finite values for a constant grid', () => {
    const features = extractGridFeatures(new Float32Array(16).fill(3), 4, 4);

    expect(features.variance).toBe(0);
    expect(features.crossCorr).toBe(0);
    expect(features.gradMean).toBe(0);
    expect(features.quantizedFingerprint).toHaveLength(16);
  });

  it('samples across the full grid instead of only the first row', () => {
    const grid = new Float32Array(16 * 16);
    grid.fill(1, 15 * 16);

    const features = extractGridFeatures(grid, 16, 16);

    expect(features.quantizedFingerprint).toContain('7');
  });

  it('rejects dimensions that do not match the data', () => {
    expect(() => extractGridFeatures(new Float32Array(3), 2, 2)).toThrow(
      'Grid dimensions do not match',
    );
  });
});
