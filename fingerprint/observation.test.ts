import { describe, expect, it } from 'vitest';
import { normalizeGpuDescriptor, normalizePlatform } from './observation';
import type { WebGLSignals } from './probes/webgl';

function webgl(renderer: string, vendor = ''): WebGLSignals {
  return {
    renderer,
    vendor,
    version: '',
    glslVersion: '',
    extensions: [],
    limits: {},
    precision: {},
    shaderHash: '',
    timing: {
      ratios: [],
      dispersion: 1,
    },
  };
}

describe('observation normalization', () => {
  it('normalizes browser-specific Apple GPU renderer strings', () => {
    const chrome = normalizeGpuDescriptor(
      webgl('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)'),
      null,
    );
    const safari = normalizeGpuDescriptor(webgl('Apple M2 Pro', 'Apple Inc.'), null);

    expect(chrome.vendor).toBe('apple');
    expect(safari.vendor).toBe('apple');
    expect(chrome.model).toBe(safari.model);
    expect(chrome.backend).toBe('metal');
  });

  it('normalizes legacy platform labels', () => {
    expect(normalizePlatform('MacIntel')).toBe('macos');
    expect(normalizePlatform('Win32')).toBe('windows');
  });

  it('treats generic GPU labels as missing model information', () => {
    expect(normalizeGpuDescriptor(webgl('Apple GPU', 'Apple Inc.'), null)).toMatchObject({
      vendor: 'apple',
      model: 'unknown',
    });
  });
});
