// sql.js (SQLite compiled to WebAssembly) driver: used by the unit tests and the
// browser development preview. Android uses the native driver instead.
import type { Database, SqlJsStatic } from 'sql.js';
import type { SqlDriver, SqlValue } from './driver';

export class SqlJsDriver implements SqlDriver {
  constructor(
    public readonly db: Database,
    private onWrite?: () => void,
  ) {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  static async create(SQL: SqlJsStatic, bytes?: Uint8Array, onWrite?: () => void): Promise<SqlJsDriver> {
    return new SqlJsDriver(bytes ? new SQL.Database(bytes) : new SQL.Database(), onWrite);
  }

  private inTx = false;

  private written() {
    if (!this.inTx) this.onWrite?.();
  }

  async exec(sql: string) {
    this.db.exec(sql);
    this.written();
  }

  async run(sql: string, params: SqlValue[] = []) {
    this.db.run(sql, params);
    const changes = this.db.getRowsModified();
    this.written();
    return { changes };
  }

  async all<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  async begin() {
    this.db.exec('BEGIN');
    this.inTx = true;
  }

  async commit() {
    this.db.exec('COMMIT');
    this.inTx = false;
    this.onWrite?.();
  }

  async rollback() {
    this.inTx = false;
    this.db.exec('ROLLBACK');
  }

  async close() {
    this.db.close();
  }

  /** Serialised database file (used to simulate a force-close in tests). */
  export(): Uint8Array {
    return this.db.export();
  }
}
