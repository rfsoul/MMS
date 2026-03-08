// src/db/database.ts
import * as SQLite from 'expo-sqlite';
import { CREATE_TABLES, CREATE_ASSET_TABLES } from './schema';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('mms.db');
  await _db.execAsync(CREATE_TABLES);
  await _db.execAsync(CREATE_ASSET_TABLES);
  return _db;
}

// ── Typed convenience wrappers ────────────────────────────────────────────────

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: (string | number | null | undefined)[] = []
): Promise<T[]> {
  const db = await getDb();
  return db.getAllAsync<T>(sql, params as SQLite.SQLiteBindValue[]);
}

export async function dbRun(
  sql: string,
  params: (string | number | null | undefined)[] = []
): Promise<SQLite.SQLiteRunResult> {
  const db = await getDb();
  return db.runAsync(sql, params as SQLite.SQLiteBindValue[]);
}

export async function dbTransaction(
  fn: (db: SQLite.SQLiteDatabase) => Promise<void>
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(() => fn(db));
}

