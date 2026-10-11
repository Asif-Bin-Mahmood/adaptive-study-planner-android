// Picks the storage driver for the current platform.
import { Capacitor } from '@capacitor/core';
import type { SqlDriver } from '../data/driver';

const DB_NAME = 'studyplanner';
const WEB_KEY = 'studyplanner-dev-db';

export async function openDriver(): Promise<SqlDriver> {
  if (Capacitor.isNativePlatform()) {
    const { CapacitorDriver } = await import('../data/capacitorDriver');
    return CapacitorDriver.open(DB_NAME);
  }
  // Browser preview for development only: sql.js persisted to localStorage.
  const [{ default: initSqlJs }, { default: wasmUrl }, { SqlJsDriver }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
    import('../data/sqljsDriver'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  let bytes: Uint8Array | undefined;
  try {
    const saved = localStorage.getItem(WEB_KEY);
    if (saved) bytes = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
  } catch {
    bytes = undefined;
  }
  let driver: InstanceType<typeof SqlJsDriver>;
  const persist = () => {
    try {
      const data = driver.export();
      let bin = '';
      for (let i = 0; i < data.length; i += 0x8000) bin += String.fromCharCode(...data.subarray(i, i + 0x8000));
      localStorage.setItem(WEB_KEY, btoa(bin));
    } catch {
      /* preview only */
    }
  };
  driver = await SqlJsDriver.create(SQL, bytes, persist);
  return driver;
}
