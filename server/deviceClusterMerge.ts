import type { DeviceMatchResult, DeviceObservation } from '@/fingerprint/observation';
import {
  CLUSTER_MERGE_THRESHOLD,
  findDeviceMatches,
  type StoredDeviceCluster,
} from '@/server/deviceMatcher';

export interface DeviceClusterResolution {
  result: DeviceMatchResult;
  mergeSourceIds: string[];
}

function timestamp(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/** Chooses the oldest strongly matching cluster and marks newer duplicates for merging. */
export function resolveDeviceCluster(
  observation: DeviceObservation,
  clusters: StoredDeviceCluster[],
): DeviceClusterResolution | null {
  const matches = findDeviceMatches(observation, clusters);
  const bestMatch = matches[0];
  if (!bestMatch) return null;

  const mergeableIds = new Set(
    matches
      .filter(({ similarityScore }) => similarityScore >= CLUSTER_MERGE_THRESHOLD)
      .map(({ deviceClusterId }) => deviceClusterId),
  );
  const mergeableClusters = clusters
    .filter(({ id }) => mergeableIds.has(id))
    .sort(
      (left, right) =>
        timestamp(left.createdAt) - timestamp(right.createdAt) || left.id.localeCompare(right.id),
    );
  const targetId = mergeableClusters[0]?.id ?? bestMatch.deviceClusterId;

  return {
    result: {
      deviceClusterId: targetId,
      confidence: bestMatch.confidence,
      evidence: bestMatch.evidence,
      matched: true,
    },
    mergeSourceIds: mergeableClusters.map(({ id }) => id).filter((id) => id !== targetId),
  };
}
