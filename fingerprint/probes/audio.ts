import { fnv1a } from '../hash';

export async function collectAudioSignals(): Promise<string> {
  const audioWindow = window as typeof window & {
    webkitOfflineAudioContext?: typeof OfflineAudioContext;
  };
  const Ctx = window.OfflineAudioContext ?? audioWindow.webkitOfflineAudioContext;
  if (!Ctx) return '';
  const ctx: OfflineAudioContext = new Ctx(1, 44100, 44100);
  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.value = 10000;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -50;
  comp.knee.value = 40;
  comp.ratio.value = 12;
  comp.attack.value = 0;
  comp.release.value = 0.25;
  osc.connect(comp);
  comp.connect(ctx.destination);
  osc.start(0);
  const buf = await ctx.startRendering();
  const data = buf.getChannelData(0).subarray(4500, 5000);
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return fnv1a(bytes);
}
