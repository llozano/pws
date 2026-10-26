import 'server-only';

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DeviceMatchResult, DeviceObservation } from '@/fingerprint/observation';
import { findDeviceMatch, type StoredDeviceCluster } from '@/server/deviceMatcher';

interface StoreDocument {
  version: 1;
  clusters: StoredDeviceCluster[];
}

const MAX_OBSERVATIONS_PER_CLUSTER = 12;
const DEFAULT_MAX_CLUSTERS = 10_000;

export class DeviceStoreCapacityError extends Error {}

export interface DeviceStore {
  register(observation: DeviceObservation): Promise<DeviceMatchResult>;
}

export class JsonDeviceStore implements DeviceStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly filePath: string,
    private readonly maxClusters = DEFAULT_MAX_CLUSTERS,
  ) {}

  register(observation: DeviceObservation): Promise<DeviceMatchResult> {
    const operation = this.queue.then(() => this.registerInternal(observation));
    this.queue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async registerInternal(observation: DeviceObservation): Promise<DeviceMatchResult> {
    const document = await this.read();
    const match = findDeviceMatch(observation, document.clusters);
    let result: DeviceMatchResult;

    if (match) {
      const cluster = document.clusters.find(({ id }) => id === match.deviceClusterId);
      if (!cluster) throw new Error('Matched device cluster disappeared before update.');
      cluster.observations.push(observation);
      cluster.observations = cluster.observations.slice(-MAX_OBSERVATIONS_PER_CLUSTER);
      cluster.updatedAt = observation.capturedAt;
      result = match;
    } else {
      if (document.clusters.length >= this.maxClusters) {
        throw new DeviceStoreCapacityError('The device store reached its configured capacity.');
      }
      const id = randomUUID();
      document.clusters.push({
        id,
        createdAt: observation.capturedAt,
        updatedAt: observation.capturedAt,
        observations: [observation],
      });
      result = {
        deviceClusterId: id,
        confidence: 0,
        evidence: 0,
        matched: false,
      };
    }

    await this.write(document);
    return result;
  }

  private async read(): Promise<StoreDocument> {
    try {
      const contents = await readFile(this.filePath, 'utf8');
      const document = JSON.parse(contents) as StoreDocument;
      if (document.version !== 1 || !Array.isArray(document.clusters)) {
        throw new Error('The device store has an unsupported format.');
      }
      return document;
    } catch (error: unknown) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        (error as NodeJS.ErrnoException).code === 'ENOENT'
      ) {
        return { version: 1, clusters: [] };
      }
      throw error;
    }
  }

  private async write(document: StoreDocument): Promise<void> {
    const directory = path.dirname(this.filePath);
    await mkdir(directory, { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(document), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, this.filePath);
  }
}

const dataPath =
  process.env.PWS_DATA_PATH ?? path.join(process.cwd(), '.pws-data', 'device-clusters.json');
const configuredCapacity = Number(process.env.PWS_MAX_DEVICE_CLUSTERS);
const capacity =
  Number.isInteger(configuredCapacity) && configuredCapacity > 0
    ? configuredCapacity
    : DEFAULT_MAX_CLUSTERS;

export const deviceStore: DeviceStore = new JsonDeviceStore(dataPath, capacity);
