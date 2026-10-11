// Versioned JSON backup: format, validation, upgrade of older backups, preview.
import { isISODate } from '../domain/dates';
import { normalizeRules } from '../domain/rules';
import { BACKUP_TABLES, COLUMNS, LATEST_VERSION, REFERENCES, type BackupTable } from './schema';
import type { SqlValue } from './driver';

export const BACKUP_FORMAT = 'study-planner-backup';
export const BACKUP_FORMAT_VERSION = 1;

export type Row = Record<string, SqlValue>;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  schemaVersion: number;
  exportedAt: string;
  appVersion: string;
  activeTermId: string | null;
  counts: Record<string, number>;
  tables: Record<BackupTable, Row[]>;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  backup: BackupFile | null;
}

const ENUMS: Partial<Record<BackupTable, Record<string, string[]>>> = {
  terms: { status: ['current', 'upcoming', 'archived'] },
  sessions: {
    status: ['planned', 'done', 'partial', 'missed', 'cancelled', 'moved', 'dropped'],
    tier: ['core', 'optional'],
    origin: ['template', 'manual', 'replan', 'seed'],
  },
  study_templates: { tier: ['core', 'optional'] },
  retests: { outcome: ['pass', 'assisted', 'fail'] },
  errors: { status: ['open', 'mastered', 'retired'] },
};

const DATE_COLUMNS = new Set(['start_date', 'end_date', 'date', 'due_date', 'valid_from', 'valid_to', 'week_start']);

/** Upgrade the rows of an older backup to the current schema, in memory. */
export function upgradeBackup(b: BackupFile): BackupFile {
  const out: BackupFile = { ...b, tables: { ...b.tables } };
  if (out.schemaVersion < 2) {
    out.tables.sessions = (out.tables.sessions ?? []).map((r) => ({ ...r, reason: r.reason ?? null }));
    out.schemaVersion = 2;
  }
  return out;
}

export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = [];
  const fail = (m: string): ValidationResult => ({ ok: false, errors: [...errors, m], backup: null });
  if (!input || typeof input !== 'object') return fail('The file is not a JSON object.');
  const raw = input as Partial<BackupFile>;
  if (raw.format !== BACKUP_FORMAT) return fail('This is not a Study Planner backup file.');
  if (raw.formatVersion !== BACKUP_FORMAT_VERSION) return fail(`Unsupported backup format version ${String(raw.formatVersion)}.`);
  if (!Number.isInteger(raw.schemaVersion) || (raw.schemaVersion as number) < 1) return fail('Missing schema version.');
  if ((raw.schemaVersion as number) > LATEST_VERSION) {
    return fail(`The backup was made by a newer app version (schema ${raw.schemaVersion}). Update the app first.`);
  }
  if (!raw.tables || typeof raw.tables !== 'object') return fail('The backup has no tables.');
  for (const t of BACKUP_TABLES) {
    if (!Array.isArray((raw.tables as Record<string, unknown>)[t])) return fail(`Table "${t}" is missing.`);
  }
  const b = upgradeBackup(raw as BackupFile);
  const ids: Partial<Record<BackupTable, Set<string>>> = {};
  for (const t of BACKUP_TABLES) {
    const spec = COLUMNS[t];
    const allowed = new Set([...spec.required, ...spec.optional]);
    const key = t === 'checkins' ? 'date' : 'id';
    const seen = new Set<string>();
    b.tables[t].forEach((row, i) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        errors.push(`${t} row ${i + 1} is not an object.`);
        return;
      }
      for (const c of spec.required) {
        if (row[c] === undefined || row[c] === null || row[c] === '') errors.push(`${t} row ${i + 1}: "${c}" is required.`);
      }
      for (const c of Object.keys(row)) {
        if (!allowed.has(c)) errors.push(`${t} row ${i + 1}: unknown column "${c}".`);
        const v = row[c];
        if (v !== null && typeof v !== 'string' && typeof v !== 'number') errors.push(`${t} row ${i + 1}: "${c}" has an invalid value.`);
        if (DATE_COLUMNS.has(c) && v != null && !isISODate(v)) errors.push(`${t} row ${i + 1}: "${c}" is not a valid date.`);
      }
      const enums = ENUMS[t] ?? {};
      for (const [c, values] of Object.entries(enums)) {
        if (row[c] != null && !values.includes(String(row[c]))) errors.push(`${t} row ${i + 1}: "${c}" has unknown value "${row[c]}".`);
      }
      const id = String(row[key]);
      if (seen.has(id)) errors.push(`${t}: duplicate id ${id}.`);
      seen.add(id);
    });
    ids[t] = seen;
  }
  for (const [t, col, parent] of REFERENCES) {
    b.tables[t].forEach((row, i) => {
      const v = row?.[col];
      if (v != null && !ids[parent]?.has(String(v))) errors.push(`${t} row ${i + 1}: "${col}" points to a missing ${parent} record.`);
    });
  }
  for (const row of b.tables.terms) {
    try {
      normalizeRules(JSON.parse(String(row.rules_json)));
    } catch (e) {
      errors.push(`Term ${row.name}: invalid planning rules (${(e as Error).message}).`);
    }
  }
  if (b.activeTermId && !ids.terms?.has(b.activeTermId)) errors.push('The active semester is missing from the backup.');
  if (errors.length > 20) return { ok: false, errors: [...errors.slice(0, 20), `…and ${errors.length - 20} more problems.`], backup: null };
  return errors.length ? { ok: false, errors, backup: null } : { ok: true, errors: [], backup: b };
}

export interface PreviewRow {
  table: BackupTable;
  current: number;
  incoming: number;
}

export function previewImport(b: BackupFile, currentCounts: Record<string, number>): { rows: PreviewRow[]; terms: string[]; lostRecords: number } {
  const rows = BACKUP_TABLES.map((t) => ({ table: t, current: currentCounts[t] ?? 0, incoming: b.tables[t].length }));
  const lostRecords = rows.reduce((a, r) => a + Math.max(0, r.current - r.incoming), 0);
  return { rows, terms: b.tables.terms.map((r) => String(r.name)), lostRecords };
}
