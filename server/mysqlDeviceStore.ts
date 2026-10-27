import 'server-only';

import { randomUUID } from 'node:crypto';
import { createPool, type Pool, type PoolConnection, type RowDataPacket } from 'mysql2/promise';
import type { DeviceMatchResult, DeviceObservation } from '@/fingerprint/observation';
import { resolveDeviceCluster } from '@/server/deviceClusterMerge';
import type { StoredDeviceCluster } from '@/server/deviceMatcher';
import {
  DeviceStoreCapacityError,
  MAX_OBSERVATIONS_PER_CLUSTER,
  type DeviceStore,
} from '@/server/deviceStoreTypes';

interface CandidateRow extends RowDataPacket {
  cluster_id: string;
  cluster_created_at: string;
  cluster_updated_at: string;
  observation: string | DeviceObservation;
}

interface CountRow extends RowDataPacket {
  cluster_count: number;
}

interface IdRow extends RowDataPacket {
  id: number;
}

interface LockRow extends RowDataPacket {
  acquired: number | null;
}

const DEVICE_MATCH_LOCK = 'pws-device-observation-match';
const DEFAULT_CANDIDATE_LIMIT = 5_000;

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseObservation(value: string | DeviceObservation): DeviceObservation {
  const observation = typeof value === 'string' ? JSON.parse(value) : value;
  if (!observation || typeof observation !== 'object' || observation.schemaVersion !== 1) {
    throw new Error('Stored device observation has an unsupported format.');
  }
  return observation;
}

function buildClusters(rows: CandidateRow[]): StoredDeviceCluster[] {
  const clusters = new Map<string, StoredDeviceCluster>();

  for (const row of rows) {
    const cluster = clusters.get(row.cluster_id) ?? {
      id: row.cluster_id,
      createdAt: String(row.cluster_created_at),
      updatedAt: String(row.cluster_updated_at),
      observations: [],
    };
    cluster.observations.push(parseObservation(row.observation));
    clusters.set(cluster.id, cluster);
  }

  return [...clusters.values()];
}

export class MySqlDeviceStore implements DeviceStore {
  constructor(
    private readonly pool: Pool,
    private readonly maxClusters: number,
    private readonly candidateLimit = DEFAULT_CANDIDATE_LIMIT,
  ) {}

  async register(observation: DeviceObservation): Promise<DeviceMatchResult> {
    const connection = await this.pool.getConnection();
    let lockAcquired = false;
    let connectionDestroyed = false;

    try {
      const [lockRows] = await connection.query<LockRow[]>('SELECT GET_LOCK(?, 10) AS acquired', [
        DEVICE_MATCH_LOCK,
      ]);
      lockAcquired = lockRows[0]?.acquired === 1;
      if (!lockAcquired) {
        throw new Error('Timed out while waiting for the device matching lock.');
      }

      return await this.registerLocked(connection, observation);
    } finally {
      if (lockAcquired) {
        try {
          const [releaseRows] = await connection.query<LockRow[]>(
            'SELECT RELEASE_LOCK(?) AS acquired',
            [DEVICE_MATCH_LOCK],
          );
          if (releaseRows[0]?.acquired !== 1) {
            throw new Error('MySQL did not release the device matching lock.');
          }
        } catch (error: unknown) {
          console.error('Failed to release the MySQL device matching lock.', error);
          connection.destroy();
          connectionDestroyed = true;
        }
      }
      if (!connectionDestroyed) connection.release();
    }
  }

  private async registerLocked(
    connection: PoolConnection,
    observation: DeviceObservation,
  ): Promise<DeviceMatchResult> {
    await connection.beginTransaction();
    try {
      const [rows] = await connection.query<CandidateRow[]>(
        `SELECT
          observations.cluster_id,
          clusters.created_at AS cluster_created_at,
          clusters.updated_at AS cluster_updated_at,
          observations.observation
        FROM device_observations AS observations
        INNER JOIN device_clusters AS clusters ON clusters.id = observations.cluster_id
        WHERE observations.platform = ?
        ORDER BY observations.id DESC
        LIMIT ${this.candidateLimit}`,
        [observation.platform],
      );

      const resolution = resolveDeviceCluster(observation, buildClusters(rows));
      const clusterId = resolution?.result.deviceClusterId ?? randomUUID();

      if (resolution) {
        if (resolution.mergeSourceIds.length > 0) {
          const placeholders = resolution.mergeSourceIds.map(() => '?').join(', ');
          for (const sourceId of resolution.mergeSourceIds) {
            await connection.execute(
              `INSERT INTO device_cluster_merges (
                source_cluster_id,
                target_cluster_id,
                reason
              ) VALUES (?, ?, ?)`,
              [sourceId, clusterId, 'strong-cross-browser-match'],
            );
          }
          await connection.execute(
            `UPDATE device_observations
            SET cluster_id = ?
            WHERE cluster_id IN (${placeholders})`,
            [clusterId, ...resolution.mergeSourceIds],
          );
          await connection.execute(
            `DELETE FROM device_clusters WHERE id IN (${placeholders})`,
            resolution.mergeSourceIds,
          );
        }
        await connection.execute('UPDATE device_clusters SET updated_at = ? WHERE id = ?', [
          new Date(observation.capturedAt),
          clusterId,
        ]);
      } else {
        const [countRows] = await connection.query<CountRow[]>(
          'SELECT COUNT(*) AS cluster_count FROM device_clusters',
        );
        if ((countRows[0]?.cluster_count ?? 0) >= this.maxClusters) {
          throw new DeviceStoreCapacityError('The device store reached its configured capacity.');
        }
        await connection.execute(
          'INSERT INTO device_clusters (id, created_at, updated_at) VALUES (?, ?, ?)',
          [clusterId, new Date(observation.capturedAt), new Date(observation.capturedAt)],
        );
      }

      await connection.execute(
        `INSERT INTO device_observations (
          cluster_id,
          captured_at,
          platform,
          architecture,
          gpu_vendor,
          gpu_model,
          observation
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          clusterId,
          new Date(observation.capturedAt),
          observation.platform,
          observation.architecture,
          observation.graphics.descriptor.vendor,
          observation.graphics.descriptor.model,
          JSON.stringify(observation),
        ],
      );

      const [cutoffRows] = await connection.query<IdRow[]>(
        `SELECT id
        FROM device_observations
        WHERE cluster_id = ?
        ORDER BY id DESC
        LIMIT 1 OFFSET ${MAX_OBSERVATIONS_PER_CLUSTER - 1}`,
        [clusterId],
      );
      const cutoffId = cutoffRows[0]?.id;
      if (cutoffId) {
        await connection.execute(
          'DELETE FROM device_observations WHERE cluster_id = ? AND id < ?',
          [clusterId, cutoffId],
        );
      }

      await connection.commit();
      return (
        resolution?.result ?? {
          deviceClusterId: clusterId,
          confidence: 0,
          evidence: 0,
          matched: false,
        }
      );
    } catch (error: unknown) {
      try {
        await connection.rollback();
      } catch (rollbackError: unknown) {
        throw new AggregateError(
          [error, rollbackError],
          'Device registration and transaction rollback both failed.',
        );
      }
      throw error;
    }
  }
}

type GlobalWithMySqlPool = typeof globalThis & {
  pwsMySqlPool?: Pool;
};

export function getMySqlPool(): Pool {
  const globalWithPool = globalThis as GlobalWithMySqlPool;
  if (!globalWithPool.pwsMySqlPool) {
    globalWithPool.pwsMySqlPool = createPool({
      host: process.env.PWS_MYSQL_HOST ?? '127.0.0.1',
      port: positiveInteger(process.env.PWS_MYSQL_PORT, 3306),
      user: process.env.PWS_MYSQL_USER ?? 'root',
      password: process.env.PWS_MYSQL_PASSWORD ?? '',
      database: process.env.PWS_MYSQL_DATABASE ?? 'pws',
      connectionLimit: positiveInteger(process.env.PWS_MYSQL_CONNECTION_LIMIT, 10),
      waitForConnections: true,
      queueLimit: 0,
      enableKeepAlive: true,
      timezone: 'Z',
      dateStrings: true,
    });
  }
  return globalWithPool.pwsMySqlPool;
}
