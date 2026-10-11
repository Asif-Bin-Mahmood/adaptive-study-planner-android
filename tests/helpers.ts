import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { SqlJsDriver } from '../src/data/sqljsDriver';
import { Repo, type TermPackage } from '../src/data/repo';
import fixture from './fixtures/demo-term.json';

let SQL: SqlJsStatic | null = null;
export async function sqljs() {
  SQL ??= await initSqlJs();
  return SQL;
}

export async function makeRepo(bytes?: Uint8Array) {
  const driver = await SqlJsDriver.create(await sqljs(), bytes);
  const repo = new Repo(driver);
  await repo.init();
  return { repo, driver };
}

/** Synthetic semester (fictional courses, rooms and dates) used only by the tests. */
export const demoTerm = fixture as unknown as TermPackage;
export const T = 'demo-term';

export async function seededRepo() {
  const r = await makeRepo();
  await r.repo.importTermPackage(demoTerm, { makeActive: true });
  return r;
}
