import type { DeviceMatchResult, DeviceObservation } from '@/fingerprint/observation';

export interface StoredDeviceCluster {
  id: string;
  createdAt: string;
  updatedAt: string;
  observations: DeviceObservation[];
}

interface Similarity {
  score: number;
  evidence: number;
}

const MATCH_THRESHOLD = 0.78;
const MIN_EVIDENCE = 0.42;
export const CLUSTER_MERGE_THRESHOLD = 0.9;

export interface DeviceMatchCandidate extends DeviceMatchResult {
  similarityScore: number;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function categoricalSimilarity(left: string, right: string): number | null {
  if (!left || !right || left === 'unknown' || right === 'unknown') return null;
  return left === right ? 1 : 0;
}

function numberSimilarity(left: number, right: number, tolerance: number): number | null {
  if (!left || !right || !Number.isFinite(left) || !Number.isFinite(right)) return null;
  return clamp(1 - Math.abs(left - right) / tolerance);
}

function tokenSimilarity(left: string, right: string): number | null {
  if (!left || !right || left === 'unknown' || right === 'unknown') return null;
  const leftTokens = new Set(left.split(/\s+/).filter(Boolean));
  const rightTokens = new Set(right.split(/\s+/).filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) return null;
  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++;
  }
  return intersection / union.size;
}

function gpuModelSimilarity(left: string, right: string): number | null {
  const genericModel = /^(gpu|graphics|graphics adapter|renderer|generic|unknown)$/;
  if (genericModel.test(left) || genericModel.test(right)) return null;
  return tokenSimilarity(left, right);
}

function vectorSimilarity(left: number[], right: number[]): number | null {
  const length = Math.min(left.length, right.length);
  if (length === 0) return null;
  let squaredDistance = 0;
  for (let i = 0; i < length; i++) {
    const scale = Math.max(1, Math.abs(left[i]), Math.abs(right[i]));
    const delta = (left[i] - right[i]) / scale;
    squaredDistance += delta * delta;
  }
  return Math.exp(-Math.sqrt(squaredDistance / length) * 2.5);
}

function timingWeight(baseWeight: number, leftDispersion: number, rightDispersion: number): number {
  const worstDispersion = Math.max(leftDispersion, rightDispersion);
  return baseWeight * clamp(1 - worstDispersion / 0.35);
}

function recordSimilarity(
  left: Record<string, number>,
  right: Record<string, number>,
): number | null {
  const keys = Object.keys(left).filter((key) => key in right);
  if (keys.length === 0) return null;
  let score = 0;
  for (const key of keys) {
    const maximum = Math.max(1, Math.abs(left[key]), Math.abs(right[key]));
    score += clamp(1 - Math.abs(left[key] - right[key]) / maximum);
  }
  return score / keys.length;
}

function matrixSimilarity(
  left: DeviceObservation['graphics']['matrix'],
  right: DeviceObservation['graphics']['matrix'],
): number | null {
  if (!left || !right) return null;
  const numeric = vectorSimilarity(
    [left.mean, left.variance, left.min, left.max],
    [right.mean, right.variance, right.min, right.max],
  );
  const shape = tokenSimilarity(left.quantized, right.quantized);
  if (numeric === null) return shape;
  if (shape === null) return numeric;
  return numeric * 0.7 + shape * 0.3;
}

export function compareDeviceObservations(
  left: DeviceObservation,
  right: DeviceObservation,
): Similarity {
  if (
    left.platform !== 'unknown' &&
    right.platform !== 'unknown' &&
    left.platform !== right.platform
  ) {
    return { score: 0, evidence: 1 };
  }
  const weightedSignals: Array<[number, number | null]> = [
    [0.08, categoricalSimilarity(left.platform, right.platform)],
    [0.07, categoricalSimilarity(left.architecture, right.architecture)],
    [
      0.15,
      categoricalSimilarity(left.graphics.descriptor.vendor, right.graphics.descriptor.vendor),
    ],
    [0.2, gpuModelSimilarity(left.graphics.descriptor.model, right.graphics.descriptor.model)],
    [0.08, recordSimilarity(left.graphics.webglLimits, right.graphics.webglLimits)],
    [0.08, recordSimilarity(left.graphics.webgpuLimits, right.graphics.webgpuLimits)],
    [0.1, matrixSimilarity(left.graphics.matrix, right.graphics.matrix)],
    [
      timingWeight(0.12, left.graphics.webglTimingDispersion, right.graphics.webglTimingDispersion),
      vectorSimilarity(left.graphics.webglTimingRatios, right.graphics.webglTimingRatios),
    ],
    [
      timingWeight(
        0.06,
        left.graphics.webgpuTimingDispersion,
        right.graphics.webgpuTimingDispersion,
      ),
      vectorSimilarity(left.graphics.webgpuTimingRatios, right.graphics.webgpuTimingRatios),
    ],
    [
      timingWeight(0.03, left.cpu.timingDispersion, right.cpu.timingDispersion),
      vectorSimilarity(left.cpu.timingRatios, right.cpu.timingRatios),
    ],
    [0.02, numberSimilarity(left.cpu.logicalCores, right.cpu.logicalCores, 8)],
    [0.01, numberSimilarity(left.cpu.memoryGiB, right.cpu.memoryGiB, 8)],
  ];

  let weightedScore = 0;
  let usedWeight = 0;
  for (const [weight, similarity] of weightedSignals) {
    if (similarity === null) continue;
    weightedScore += weight * similarity;
    usedWeight += weight;
  }

  return {
    score: usedWeight > 0 ? weightedScore / usedWeight : 0,
    evidence: usedWeight,
  };
}

export function findDeviceMatches(
  observation: DeviceObservation,
  clusters: StoredDeviceCluster[],
): DeviceMatchCandidate[] {
  const matches: DeviceMatchCandidate[] = [];

  for (const cluster of clusters) {
    let bestScore = 0;
    let bestEvidence = 0;
    for (const existing of cluster.observations) {
      const similarity = compareDeviceObservations(observation, existing);
      if (
        similarity.score > bestScore ||
        (similarity.score === bestScore && similarity.evidence > bestEvidence)
      ) {
        bestScore = similarity.score;
        bestEvidence = similarity.evidence;
      }
    }

    if (bestScore >= MATCH_THRESHOLD && bestEvidence >= MIN_EVIDENCE) {
      matches.push({
        deviceClusterId: cluster.id,
        confidence: clamp(bestScore * Math.min(1, bestEvidence / 0.65)),
        evidence: bestEvidence,
        matched: true,
        similarityScore: bestScore,
      });
    }
  }

  return matches.sort(
    (left, right) => right.similarityScore - left.similarityScore || right.evidence - left.evidence,
  );
}

export function findDeviceMatch(
  observation: DeviceObservation,
  clusters: StoredDeviceCluster[],
): DeviceMatchResult | null {
  return findDeviceMatches(observation, clusters)[0] ?? null;
}
