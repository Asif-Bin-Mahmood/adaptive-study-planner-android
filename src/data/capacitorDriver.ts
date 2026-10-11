// Native SQLite on Android via @capacitor-community/sqlite. Every write is
// committed to the app's private database file immediately.
import { CapacitorSQLite, SQLiteConnection, type SQLiteDBConnection } from '@capacitor-community/sqlite';
import type { SqlDriver, SqlValue } from './driver';

export class CapacitorDriver implements SqlDriver {
  private constructor(private conn: SQLiteDBConnection) {}

  static async open(name: string): Promise<CapacitorDriver> {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    const consistent = (await sqlite.checkConnectionsConsistency()).result;
    const exists = (await sqlite.isConnection(name, false)).result;
    const conn =
      consistent && exists
        ? await sqlite.retrieveConnection(name, false)
        : await sqlite.createConnection(name, false, 'no-encryption', 1, false);
    await conn.open();
    await conn.execute('PRAGMA foreign_keys = ON;', false);
    return new CapacitorDriver(conn);
  }

  async exec(sql: string) {
    await this.conn.execute(sql, false);
  }

  async run(sql: string, params: SqlValue[] = []) {
    const r = await this.conn.run(sql, params, false);
    return { changes: r.changes?.changes ?? 0 };
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const r = await this.conn.query(sql, params);
    return (r.values ?? []) as T[];
  }

  async begin() {
    await this.conn.beginTransaction();
  }

  async commit() {
    await this.conn.commitTransaction();
  }

  async rollback() {
    await this.conn.rollbackTransaction();
  }

  async close() {
    await this.conn.close();
  }
}
