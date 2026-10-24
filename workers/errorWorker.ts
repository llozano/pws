// public/errorWorker.js (TypeScript typed syntax)

interface WorkerInputData {
    width: number;
    startY: number;
    endY: number;
    totalHeight: number;
    zoom: number;
}

interface WorkerOutputData {
    errorChunk: Float32Array;
    startY: number;
}

self.onmessage = function (e: MessageEvent<WorkerInputData>): void {
    const { width, startY, endY, totalHeight, zoom } = e.data;
    const chunkHeight: number = endY - startY;

    // Allocate type-safe flat binary register block
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

            let zx_smooth: number = 0.0, zy_smooth: number = 0.0;
            let zx_glitch: number = 0.0, zy_glitch: number = 0.0;
            let accumulatedError: number = 0.0;

            for (let i = 0; i < maxIterations; i++) {
                const nextSmoothX: number = zx_smooth * zx_smooth - zy_smooth * zy_smooth + cx;
                const nextSmoothY: number = 2.0 * zx_smooth * zy_smooth + cy;
                zx_smooth = nextSmoothX;
                zy_smooth = nextSmoothY;

                let nextGlitchX: number = zx_glitch * zx_glitch - zy_glitch * zy_glitch + cx;
                let nextGlitchY: number = 2.0 * zx_glitch * zy_glitch + cy;
                nextGlitchX = Math.floor(nextGlitchX * 64.0) / 64.0;
                nextGlitchY = Math.floor(nextGlitchY * 64.0) / 64.0;
                zx_glitch = nextGlitchX;
                zy_glitch = nextGlitchY;

                const dx: number = zx_smooth - zx_glitch;
                const dy: number = zy_smooth - zy_glitch;
                accumulatedError += Math.sqrt(dx * dx + dy * dy);

                if ((zx_smooth * zx_smooth + zy_smooth * zy_smooth) > 4.0) break;
            }
            errorChunk[chunkOffset + x] = accumulatedError;
        }
    }

    // Type-safe transfer of buffer ownership to prevent UI thread freezing
    const response: WorkerOutputData = { errorChunk, startY };
    (self as any).postMessage(response, [errorChunk.buffer]);
};
