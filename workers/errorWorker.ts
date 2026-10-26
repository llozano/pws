/// <reference lib="webworker" />
import { MANDELBROT_PROBE } from '@/fingerprint/fractalConfig';
import type { WorkerInbound, WorkerOutbound } from './messages';

declare const self: DedicatedWorkerGlobalScope;

// Computes one horizontal tile of the Mandelbrot difference grid.
self.onmessage = function (e: MessageEvent<WorkerInbound>): void {
  const msg = e.data;
  if (!msg || msg.type !== 'pws:tile-request') return;

  try {
    const { jobId, width, startY, endY, totalHeight, zoom } = msg;

    const chunkHeight: number = endY - startY;
    const errorChunk: Float32Array = new Float32Array(width * chunkHeight);

    const maxIterations = MANDELBROT_PROBE.defaultMaxIterations;
    const targetX = MANDELBROT_PROBE.targetX;
    const targetY = MANDELBROT_PROBE.targetY;

    for (let y = startY; y < endY; y++) {
      const uvY: number = (y - 0.5 * totalHeight) / totalHeight;
      const chunkOffset: number = (y - startY) * width;

      for (let x = 0; x < width; x++) {
        const uvX: number = (x - 0.5 * width) / totalHeight;
        const cx: number = uvX * 2.5 * zoom + targetX;
        const cy: number = uvY * 2.5 * zoom + targetY;

        let zx_smooth = 0.0,
          zy_smooth = 0.0;
        let zx_glitch = 0.0,
          zy_glitch = 0.0;
        let accumulatedError = 0.0;

        for (let i = 0; i < maxIterations; i++) {
          const nextSmoothX = zx_smooth * zx_smooth - zy_smooth * zy_smooth + cx;
          const nextSmoothY = 2.0 * zx_smooth * zy_smooth + cy;
          zx_smooth = nextSmoothX;
          zy_smooth = nextSmoothY;

          let nextGlitchX = zx_glitch * zx_glitch - zy_glitch * zy_glitch + cx;
          let nextGlitchY = 2.0 * zx_glitch * zy_glitch + cy;
          nextGlitchX =
            Math.floor(nextGlitchX * MANDELBROT_PROBE.quantizationScale) /
            MANDELBROT_PROBE.quantizationScale;
          nextGlitchY =
            Math.floor(nextGlitchY * MANDELBROT_PROBE.quantizationScale) /
            MANDELBROT_PROBE.quantizationScale;
          zx_glitch = nextGlitchX;
          zy_glitch = nextGlitchY;

          const dx = zx_smooth - zx_glitch;
          const dy = zy_smooth - zy_glitch;
          const delta = Math.sqrt(dx * dx + dy * dy);
          accumulatedError += Number.isFinite(delta)
            ? Math.min(delta, MANDELBROT_PROBE.maxDeltaPerIteration)
            : MANDELBROT_PROBE.maxDeltaPerIteration;

          const smoothRadius = zx_smooth * zx_smooth + zy_smooth * zy_smooth;
          const quantizedRadius = zx_glitch * zx_glitch + zy_glitch * zy_glitch;
          if (
            !Number.isFinite(smoothRadius) ||
            !Number.isFinite(quantizedRadius) ||
            smoothRadius > 4.0 ||
            quantizedRadius > 4.0
          ) {
            break;
          }
        }
        errorChunk[chunkOffset + x] = accumulatedError;
      }
    }

    const response: WorkerOutbound = {
      type: 'pws:tile-response',
      jobId,
      startY,
      errorChunk,
    };

    self.postMessage(response, [errorChunk.buffer]);
  } catch (err) {
    const e = err instanceof Error ? err : new Error(String(err));
    self.postMessage({
      type: 'pws:error',
      jobId: msg.jobId,
      message: e.message,
      stack: e.stack,
    } satisfies WorkerOutbound);
  }
};
