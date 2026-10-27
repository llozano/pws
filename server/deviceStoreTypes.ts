import type { DeviceMatchResult, DeviceObservation } from '@/fingerprint/observation';

export const MAX_OBSERVATIONS_PER_CLUSTER = 12;
export const DEFAULT_MAX_CLUSTERS = 10_000;

export class DeviceStoreCapacityError extends Error {}

export interface DeviceStore {
  register(observation: DeviceObservation): Promise<DeviceMatchResult>;
}
