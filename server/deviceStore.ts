import 'server-only';

import path from 'node:path';
import { JsonDeviceStore } from '@/server/jsonDeviceStore';
import { getMySqlPool, MySqlDeviceStore } from '@/server/mysqlDeviceStore';
import { DEFAULT_MAX_CLUSTERS, type DeviceStore } from '@/server/deviceStoreTypes';

export { DeviceStoreCapacityError } from '@/server/deviceStoreTypes';

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createDeviceStore(): DeviceStore {
  const backend = process.env.PWS_STORAGE ?? 'json';
  const maxClusters = positiveInteger(process.env.PWS_MAX_DEVICE_CLUSTERS, DEFAULT_MAX_CLUSTERS);

  if (backend === 'mysql') {
    return new MySqlDeviceStore(
      getMySqlPool(),
      maxClusters,
      positiveInteger(process.env.PWS_MYSQL_CANDIDATE_LIMIT, 5_000),
    );
  }

  if (backend === 'json') {
    const dataPath =
      process.env.PWS_DATA_PATH ?? path.join(process.cwd(), '.pws-data', 'device-clusters.json');
    return new JsonDeviceStore(dataPath, maxClusters);
  }

  throw new Error(`Unsupported PWS_STORAGE backend: ${backend}`);
}

export const deviceStore = createDeviceStore();
