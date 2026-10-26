import { describe, expect, it } from 'vitest';
import { compareFractalGrids } from './fractalGpu';

describe('compareFractalGrids', () => {
  it('reports identical grids as stable', () => {
    const grid = new Float32Array([0, 0.25, 1, 10]);

    expect(compareFractalGrids(grid, grid.slice())).toEqual({
      changedPixels: 0,
      changedPixelRatio: 0,
      meanAbsoluteDelta: 0,
      maxAbsoluteDelta: 0,
    });
  });

  it('measures changed pixels and numerical drift', () => {
    const comparison = compareFractalGrids(
      new Float32Array([0, 1, 2, 3]),
      new Float32Array([0, 1.5, 2, 4]),
    );

    expect(comparison.changedPixels).toBe(2);
    expect(comparison.changedPixelRatio).toBe(0.5);
    expect(comparison.meanAbsoluteDelta).toBe(0.375);
    expect(comparison.maxAbsoluteDelta).toBe(1);
  });

  it('rejects grids with different dimensions', () => {
    expect(() => compareFractalGrids(new Float32Array([1]), new Float32Array([1, 2]))).toThrow(
      'same non-zero length',
    );
  });
});
