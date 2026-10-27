import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';

const directory = path.dirname(fileURLToPath(import.meta.url));
const projectDirectory = path.dirname(directory);
const migrationsDirectory = path.join(directory, 'migrations');

try {
  loadEnvFile(path.join(projectDirectory, '.env.local'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const database = process.env.PWS_MYSQL_DATABASE ?? 'pws';
const port = Number(process.env.PWS_MYSQL_PORT ?? 3306);

if (!/^[A-Za-z0-9_]+$/.test(database)) {
  throw new Error('PWS_MYSQL_DATABASE may contain only letters, numbers, and underscores.');
}
if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
  throw new Error('PWS_MYSQL_PORT must be a valid TCP port.');
}

const connection = await mysql.createConnection({
  host: process.env.PWS_MYSQL_HOST ?? '127.0.0.1',
  port,
  user: process.env.PWS_MYSQL_USER ?? 'root',
  password: process.env.PWS_MYSQL_PASSWORD ?? '',
  multipleStatements: true,
});

try {
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
  );
  await connection.query(`USE \`${database}\``);
  await connection.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (version)
    ) ENGINE = InnoDB
  `);

  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const migrationFile of migrationFiles) {
    const [existing] = await connection.execute(
      'SELECT version FROM schema_migrations WHERE version = ?',
      [migrationFile],
    );
    if (Array.isArray(existing) && existing.length > 0) {
      console.log(`Skipping ${migrationFile}`);
      continue;
    }

    const sql = await readFile(path.join(migrationsDirectory, migrationFile), 'utf8');
    await connection.beginTransaction();
    try {
      await connection.query(sql);
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [
        migrationFile,
      ]);
      await connection.commit();
      console.log(`Applied ${migrationFile}`);
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
} finally {
  await connection.end();
}
