import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'mysql2/promise';
import type { DeviceObservation } from '@/fingerprint/observation';
import { DeviceStoreCapacityError } from './deviceStoreTypes';

vi.mock('server-only', () => ({}));

import { MySqlDeviceStore } from './mysqlDeviceStore';

function observation(): DeviceObservation {
  return {
    schemaVersion: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    platform: 'macos',
    architecture: 'arm64',
    bitness: '64',
    mobile: false,
    availability: {
      webgl: true,
      webgpu: true,
    },
    cpu: {
      logicalCores: 12,
      memoryGiB: 24,
      timingRatios: [1, 2, 0.8],
      timingDispersion: 0.02,
    },
    graphics: {
      descriptor: {
        vendor: 'apple',
        model: 'm4 pro',
        backend: 'metal',
      },
      webglLimits: {
        MAX_TEXTURE_SIZE: 16_384,
      },
      webgpuLimits: {
        maxTextureDimension2D: 16_384,
      },
      matrix: {
        mean: 1,
        variance: 0.5,
        min: -1,
        max: 2,
        quantized: '0 1 2 3',
      },
      webglTimingRatios: [1, 1.5, 2.2],
      webglTimingDispersion: 0.02,
      webgpuTimingRatios: [1, 1.2, 1.5],
      webgpuTimingDispersion: 0.02,
    },
    syntheticGrid: {
      entropy: 4,
      mean: 2,
      variance: 1,
      shape: '0123',
    },
  };
}

class FakeConnection {
  candidateRows: object[] = [];
  clusterCount = 0;
  cutoffRows: object[] = [];
  statements: string[] = [];
  committed = false;
  rolledBack = false;
  released = false;
  destroyed = false;

  async query(sql: string): Promise<[object[], object[]]> {
    this.statements.push(sql);
    if (sql.includes('GET_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('RELEASE_LOCK')) return [[{ acquired: 1 }], []];
    if (sql.includes('FROM device_observations AS observations')) {
      return [this.candidateRows, []];
    }
    if (sql.includes('COUNT(*) AS cluster_count')) {
      return [[{ cluster_count: this.clusterCount }], []];
    }
    if (sql.includes('SELECT id') && sql.includes('OFFSET')) {
      return [this.cutoffRows, []];
    }
    throw new Error(`Unexpected query: ${sql}`);
  }

  async execute(sql: string): Promise<[object, object[]]> {
    this.statements.push(sql);
    return [{ affectedRows: 1 }, []];
  }

  async beginTransaction(): Promise<void> {}

  async commit(): Promise<void> {
    this.committed = true;
  }

  async rollback(): Promise<void> {
    this.rolledBack = true;
  }

  release(): void {
    this.released = true;
  }

  destroy(): void {
    this.destroyed = true;
  }
}

function storeWith(connection: FakeConnection, maxClusters = 10): MySqlDeviceStore {
  const pool = {
    getConnection: async () => connection,
  };
  return new MySqlDeviceStore(pool as unknown as Pool, maxClusters);
}

describe('MySqlDeviceStore', () => {
  it('creates a new cluster and stores its first observation', async () => {
    const connection = new FakeConnection();

    const result = await storeWith(connection).register(observation());

    expect(result.matched).toBe(false);
    expect(result.deviceClusterId).toMatch(/^[0-9a-f-]{36}$/);
    expect(connection.committed).toBe(true);
    expect(connection.released).toBe(true);
    expect(
      connection.statements.some((statement) => statement.includes('INSERT INTO device_clusters')),
    ).toBe(true);
    expect(
      connection.statements.some((statement) =>
        statement.includes('INSERT INTO device_observations'),
      ),
    ).toBe(true);
  });

  it('updates an existing cluster when its observation matches', async () => {
    const connection = new FakeConnection();
    connection.candidateRows = [
      {
        cluster_id: 'existing-cluster',
        cluster_created_at: '2026-01-01 00:00:00.000',
        cluster_updated_at: '2026-01-01 00:00:00.000',
        observation: JSON.stringify(observation()),
      },
    ];

    const result = await storeWith(connection).register(observation());

    expect(result).toMatchObject({
      deviceClusterId: 'existing-cluster',
      matched: true,
    });
    expect(
      connection.statements.some((statement) => statement.includes('UPDATE device_clusters')),
    ).toBe(true);
  });

  it('merges newer duplicate clusters into the oldest strong match', async () => {
    const connection = new FakeConnection();
    connection.candidateRows = [
      {
        cluster_id: 'newer-cluster',
        cluster_created_at: '2026-01-02T00:00:00.000Z',
        cluster_updated_at: '2026-01-02T00:00:00.000Z',
        observation: JSON.stringify(observation()),
      },
      {
        cluster_id: 'older-cluster',
        cluster_created_at: '2026-01-01T00:00:00.000Z',
        cluster_updated_at: '2026-01-01T00:00:00.000Z',
        observation: JSON.stringify(observation()),
      },
    ];

    const result = await storeWith(connection).register(observation());

    expect(result).toMatchObject({
      deviceClusterId: 'older-cluster',
      matched: true,
    });
    expect(
      connection.statements.some((statement) =>
        statement.includes('INSERT INTO device_cluster_merges'),
      ),
    ).toBe(true);
    expect(
      connection.statements.some((statement) => statement.includes('UPDATE device_observations')),
    ).toBe(true);
    expect(
      connection.statements.some((statement) => statement.includes('DELETE FROM device_clusters')),
    ).toBe(true);
  });

  it('rolls back when cluster capacity has been reached', async () => {
    const connection = new FakeConnection();
    connection.clusterCount = 10;

    await expect(storeWith(connection, 10).register(observation())).rejects.toBeInstanceOf(
      DeviceStoreCapacityError,
    );
    expect(connection.rolledBack).toBe(true);
    expect(connection.released).toBe(true);
  });
});
