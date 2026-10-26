import { fnv1a } from '../hash';

export function collectCanvasSignals(): string {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.textBaseline = 'top';
  ctx.font = '17px "Arial"';
  ctx.fillStyle = '#f60';
  ctx.fillRect(20, 20, 100, 60);
  ctx.fillStyle = '#069';
  ctx.fillText('PWS fingerprint ☃ 🚀 0123', 15, 25);
  ctx.fillStyle = 'rgba(102,204,0,0.7)';
  ctx.fillText('PWS fingerprint ☃ 🚀 0123', 15, 55);
  // gradients & arcs exercise GPU rasterizer
  const g = ctx.createLinearGradient(0, 0, 256, 256);
  g.addColorStop(0, 'red');
  g.addColorStop(1, 'blue');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 1.7);
  ctx.fill();
  const data = ctx.getImageData(0, 0, 256, 256).data;
  return fnv1a(data);
}
