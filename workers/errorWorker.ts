/// <reference lib="webworker" />
import type { WorkerInbound, WorkerOutbound } from './messages';

declare const self: DedicatedWorkerGlobalScope;

self.onmessage = function (e: MessageEvent<WorkerInbound>): void {
  const msg = e.data;
  if (!msg || msg.type !== 'pws:tile-request') return;

  try {
    const { jobId, width, startY, endY, totalHeight, zoom } = msg;

    const chunkHeight: number = endY - startY;
    const errorChunk: Float32Array = new Float32Array(width * chunkHeight);

    const maxIterations: number = 100;
    const targetX: number = -0.7436;
    const targetY: number = 0.1318;

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
          nextGlitchX = Math.floor(nextGlitchX * 64.0) / 64.0;
          nextGlitchY = Math.floor(nextGlitchY * 64.0) / 64.0;
          zx_glitch = nextGlitchX;
          zy_glitch = nextGlitchY;

          const dx = zx_smooth - zx_glitch;
          const dy = zy_smooth - zy_glitch;
          accumulatedError += Math.sqrt(dx * dx + dy * dy);

          if (zx_smooth * zx_smooth + zy_smooth * zy_smooth > 4.0) break;
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
