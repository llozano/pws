import { extractGridFeatures } from './features';
import { collectWebGLSignals } from './probes/webgl';
import { collectWebGPUSignals } from './probes/webgpu';
import { collectCanvasSignals } from './probes/canvas';
import { collectAudioSignals } from './probes/audio';
import { collectCpuTimingSignals } from './probes/cpu';
import { buildFingerprint } from './aggregate';
import type { DeviceObservation, UserAgentSignals } from './observation';

export interface FullFingerprint {
  id: string;
  canonical: string;
  observation: DeviceObservation;
  warnings: string[];
}

interface NavigatorUAData {
  platform?: string;
  mobile?: boolean;
  getHighEntropyValues?: (
    hints: string[],
  ) => Promise<{ architecture?: string; bitness?: string; platform?: string }>;
}

async function collectUserAgentSignals(): Promise<UserAgentSignals> {
  const navigatorWithUA = navigator as Navigator & { userAgentData?: NavigatorUAData };
  const ua = navigatorWithUA.userAgentData;
  let highEntropy: Awaited<ReturnType<NonNullable<NavigatorUAData['getHighEntropyValues']>>> = {};

  if (ua?.getHighEntropyValues) {
    highEntropy = await ua.getHighEntropyValues(['architecture', 'bitness']);
  }

  return {
    platform: highEntropy.platform || ua?.platform || navigator.platform,
    architecture: highEntropy.architecture || '',
    bitness: highEntropy.bitness || '',
    mobile: ua?.mobile ?? /Android|iPhone|iPad/i.test(navigator.userAgent),
  };
}

export async function computeDeviceFingerprint(opts: {
  potentialGrid: Float32Array;
  width: number;
  height: number;
  audioAllowed?: boolean;
}): Promise<FullFingerprint> {
  const gridFeatures = extractGridFeatures(opts.potentialGrid, opts.width, opts.height);
  const warnings: string[] = [];

  const collectOptional = async <T>(
    name: string,
    collect: () => T | Promise<T>,
    fallback: T,
  ): Promise<T> => {
    try {
      return await collect();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${name}: ${message}`);
      return fallback;
    }
  };

  const [webgl, canvasHash, audioHash, webgpu, cpuTiming, uaData] = await Promise.all([
    collectOptional('WebGL', collectWebGLSignals, null),
    collectOptional('Canvas', collectCanvasSignals, ''),
    opts.audioAllowed ? collectOptional('Audio', collectAudioSignals, '') : Promise.resolve(''),
    collectOptional('WebGPU', collectWebGPUSignals, null),
    collectOptional('CPU timing', collectCpuTimingSignals, null),
    collectOptional('User-agent data', collectUserAgentSignals, {
      platform: navigator.platform,
      architecture: '',
      bitness: '',
      mobile: /Android|iPhone|iPad/i.test(navigator.userAgent),
    }),
  ]);

  const screenHash = `${screen.width}x${screen.height}x${screen.colorDepth}x${devicePixelRatio}`;

  const fingerprint = await buildFingerprint({
    gridFeatures,
    webgl,
    webgpu,
    canvasHash,
    audioHash,
    cpuTiming,
    uaData,
    screenHash,
  });

  return {
    ...fingerprint,
    warnings: warnings.sort(),
  };
}
