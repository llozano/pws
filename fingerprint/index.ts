import { extractGridFeatures } from './features';
import { collectWebGLSignals } from './probes/webgl';
import { collectWebGPUSignals } from './probes/webgpu';
import { collectCanvasSignals } from './probes/canvas';
import { collectAudioSignals } from './probes/audio';
import { buildFingerprint } from './aggregate';

export interface FullFingerprint {
  id: string;
  canonical: string;
}

export async function computeDeviceFingerprint(opts: {
  potentialGrid: Float32Array;
  width: number;
  height: number;
  audioAllowed?: boolean; // true only after a user gesture
}): Promise<FullFingerprint> {
  const gridFeatures = extractGridFeatures(opts.potentialGrid, opts.width, opts.height);

  const webgl = collectWebGLSignals();
  const canvasHash = collectCanvasSignals();
  const audioHash = opts.audioAllowed ? await collectAudioSignals() : '';
  const webgpu = await collectWebGPUSignals(); // guarded internally

  const ua = (navigator as any).userAgentData;
  const uaData = ua
    ? {
        platform: ua.platform,
        arch: ua.architecture,
        bitness: ua.bitness,
        mobile: ua.mobile,
      }
    : undefined;

  const screenHash = `${screen.width}x${screen.height}x${screen.colorDepth}x${devicePixelRatio}`;

  return buildFingerprint({
    gridFeatures,
    webgl,
    webgpu,
    canvasHash,
    audioHash,
    uaData,
    screenHash,
  });
}
