// Minimal SQL interface. The repository depends only on this, so storage can be
// tested in Node (sql.js) and run on Android (@capacitor-community/sqlite).
export type SqlValue = string | number | null;

export interface SqlDriver {
  /** Run one or more statements without parameters. */
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ changes: number }>;
  all<T = Record<string, SqlValue>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
}

/** Runs `fn` atomically. Nested calls join the outer transaction. */
export class TxRunner {
  private depth = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private db: SqlDriver) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.depth > 0) return fn();
    // serialise top-level transactions so two UI actions cannot interleave
    const next = this.queue.then(async () => {
      this.depth++;
      await this.db.begin();
      try {
        const out = await fn();
        await this.db.commit();
        return out;
      } catch (e) {
        try {
          await this.db.rollback();
        } catch {
          /* keep the original error */
        }
        throw e;
      } finally {
        this.depth--;
      }
    });
    this.queue = next.catch(() => undefined);
    return next;
  }
}
