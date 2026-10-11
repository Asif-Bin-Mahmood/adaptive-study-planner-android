// Versioned schema. Migrations only add; they never drop or rewrite user data.
// See docs/DATABASE.md for the entity description.

export interface Migration {
  version: number;
  description: string;
  statements: string[];
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial semester-independent schema',
    statements: [
      `CREATE TABLE IF NOT EXISTS terms (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, institution TEXT, academic_year TEXT,
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, status TEXT NOT NULL,
        timezone TEXT NOT NULL, rules_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS date_exceptions (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id),
        start_date TEXT NOT NULL, end_date TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL,
        cancels_classes INTEGER NOT NULL DEFAULT 0, suppresses_study INTEGER NOT NULL DEFAULT 0)`,
      `CREATE TABLE IF NOT EXISTS workstreams (
        id TEXT PRIMARY KEY, term_id TEXT REFERENCES terms(id), type TEXT NOT NULL, code TEXT,
        name TEXT NOT NULL, color TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 3, deadline TEXT,
        min_weekly_minutes INTEGER NOT NULL DEFAULT 0, target_weekly_minutes INTEGER NOT NULL DEFAULT 0,
        extension_weekly_minutes INTEGER NOT NULL DEFAULT 0, floor_rule TEXT,
        archived INTEGER NOT NULL DEFAULT 0, notes TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY, workstream_id TEXT NOT NULL REFERENCES workstreams(id),
        name TEXT NOT NULL, sort INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS commitments (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), workstream_id TEXT REFERENCES workstreams(id),
        kind TEXT NOT NULL, title TEXT NOT NULL, location TEXT, weekdays TEXT NOT NULL,
        start_time TEXT NOT NULL, end_time TEXT NOT NULL, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS commitment_changes (
        id TEXT PRIMARY KEY, commitment_id TEXT NOT NULL REFERENCES commitments(id),
        date TEXT NOT NULL, kind TEXT NOT NULL, start_time TEXT, end_time TEXT, reason TEXT,
        UNIQUE (commitment_id, date, kind))`,
      `CREATE TABLE IF NOT EXISTS assessments (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), workstream_id TEXT REFERENCES workstreams(id),
        kind TEXT NOT NULL, title TEXT NOT NULL, date TEXT NOT NULL, start_time TEXT, end_time TEXT,
        confirmed INTEGER NOT NULL DEFAULT 1, notes TEXT)`,
      `CREATE TABLE IF NOT EXISTS study_templates (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), workstream_id TEXT REFERENCES workstreams(id),
        title TEXT NOT NULL, output TEXT, kind TEXT NOT NULL, weekday INTEGER NOT NULL,
        start_time TEXT NOT NULL, duration_min INTEGER NOT NULL, tier TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, valid_from TEXT NOT NULL, valid_to TEXT NOT NULL,
        depends_on_commitment_id TEXT REFERENCES commitments(id), depends_on_weekday INTEGER)`,
      `CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), workstream_id TEXT REFERENCES workstreams(id),
        template_id TEXT REFERENCES study_templates(id), assessment_id TEXT REFERENCES assessments(id),
        date TEXT NOT NULL, start_time TEXT, duration_min INTEGER NOT NULL, title TEXT NOT NULL, output TEXT,
        kind TEXT NOT NULL, tier TEXT NOT NULL, status TEXT NOT NULL, actual_minutes INTEGER, output_note TEXT,
        origin TEXT NOT NULL, moved_from_id TEXT REFERENCES sessions(id),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        UNIQUE (template_id, date))`,
      `CREATE INDEX IF NOT EXISTS idx_sessions_term_date ON sessions(term_id, date)`,
      `CREATE TABLE IF NOT EXISTS checkins (
        date TEXT PRIMARY KEY, sleep_hours REAL, concentration INTEGER, low_energy INTEGER NOT NULL DEFAULT 0,
        note TEXT, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS timed_sets (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), workstream_id TEXT NOT NULL REFERENCES workstreams(id),
        session_id TEXT REFERENCES sessions(id), date TEXT NOT NULL, topic TEXT, attempted INTEGER, correct INTEGER,
        minutes INTEGER, target_minutes INTEGER, notes TEXT, created_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS errors (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), workstream_id TEXT NOT NULL REFERENCES workstreams(id),
        timed_set_id TEXT REFERENCES timed_sets(id), date TEXT NOT NULL, question TEXT NOT NULL, category TEXT NOT NULL,
        cause TEXT, correction_rule TEXT, similar_ref TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS retests (
        id TEXT PRIMARY KEY, error_id TEXT NOT NULL REFERENCES errors(id), due_date TEXT NOT NULL,
        label TEXT NOT NULL, done_date TEXT, outcome TEXT)`,
      `CREATE TABLE IF NOT EXISTS weekly_reviews (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), week_start TEXT NOT NULL,
        decision TEXT, notes TEXT, snapshot_json TEXT, created_at TEXT NOT NULL,
        UNIQUE (term_id, week_start))`,
      `CREATE TABLE IF NOT EXISTS schedule_changes (
        id TEXT PRIMARY KEY, term_id TEXT NOT NULL REFERENCES terms(id), date TEXT NOT NULL,
        scenario TEXT NOT NULL, summary TEXT NOT NULL, details_json TEXT, created_at TEXT NOT NULL)`,
    ],
  },
  {
    version: 2,
    description: 'Replan reasons on sessions; reminder bookkeeping; retest index',
    statements: [
      `ALTER TABLE sessions ADD COLUMN reason TEXT`,
      `CREATE TABLE IF NOT EXISTS notification_map (
        id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, fingerprint TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_retests_due ON retests(due_date)`,
    ],
  },
];

export const LATEST_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables included in a backup, in insert order (parents before children). */
export const BACKUP_TABLES = [
  'terms',
  'date_exceptions',
  'workstreams',
  'topics',
  'commitments',
  'commitment_changes',
  'assessments',
  'study_templates',
  'sessions',
  'checkins',
  'timed_sets',
  'errors',
  'retests',
  'weekly_reviews',
  'schedule_changes',
] as const;

export type BackupTable = (typeof BACKUP_TABLES)[number];

/** Columns per table at LATEST_VERSION (used to validate imported backups). */
export const COLUMNS: Record<BackupTable, { required: string[]; optional: string[] }> = {
  terms: { required: ['id', 'name', 'start_date', 'end_date', 'status', 'timezone', 'rules_json', 'created_at', 'updated_at'], optional: ['institution', 'academic_year'] },
  date_exceptions: { required: ['id', 'term_id', 'start_date', 'end_date', 'name', 'kind', 'cancels_classes', 'suppresses_study'], optional: [] },
  workstreams: {
    required: ['id', 'type', 'name', 'color', 'priority', 'min_weekly_minutes', 'target_weekly_minutes', 'extension_weekly_minutes', 'archived', 'created_at', 'updated_at'],
    optional: ['term_id', 'code', 'deadline', 'floor_rule', 'notes'],
  },
  topics: { required: ['id', 'workstream_id', 'name', 'sort', 'created_at'], optional: [] },
  commitments: { required: ['id', 'term_id', 'kind', 'title', 'weekdays', 'start_time', 'end_time', 'valid_from', 'valid_to'], optional: ['workstream_id', 'location'] },
  commitment_changes: { required: ['id', 'commitment_id', 'date', 'kind'], optional: ['start_time', 'end_time', 'reason'] },
  assessments: { required: ['id', 'term_id', 'kind', 'title', 'date', 'confirmed'], optional: ['workstream_id', 'start_time', 'end_time', 'notes'] },
  study_templates: {
    required: ['id', 'term_id', 'title', 'kind', 'weekday', 'start_time', 'duration_min', 'tier', 'active', 'valid_from', 'valid_to'],
    optional: ['workstream_id', 'output', 'depends_on_commitment_id', 'depends_on_weekday'],
  },
  sessions: {
    required: ['id', 'term_id', 'date', 'duration_min', 'title', 'kind', 'tier', 'status', 'origin', 'created_at', 'updated_at'],
    optional: ['workstream_id', 'template_id', 'assessment_id', 'start_time', 'output', 'actual_minutes', 'output_note', 'moved_from_id', 'reason'],
  },
  checkins: { required: ['date', 'low_energy', 'updated_at'], optional: ['sleep_hours', 'concentration', 'note'] },
  timed_sets: {
    required: ['id', 'term_id', 'workstream_id', 'date', 'created_at'],
    optional: ['session_id', 'topic', 'attempted', 'correct', 'minutes', 'target_minutes', 'notes'],
  },
  errors: {
    required: ['id', 'term_id', 'workstream_id', 'date', 'question', 'category', 'status', 'created_at', 'updated_at'],
    optional: ['timed_set_id', 'cause', 'correction_rule', 'similar_ref'],
  },
  retests: { required: ['id', 'error_id', 'due_date', 'label'], optional: ['done_date', 'outcome'] },
  weekly_reviews: { required: ['id', 'term_id', 'week_start', 'created_at'], optional: ['decision', 'notes', 'snapshot_json'] },
  schedule_changes: { required: ['id', 'term_id', 'date', 'scenario', 'summary', 'created_at'], optional: ['details_json'] },
};

/** Foreign keys checked during backup validation: [table, column, parentTable]. */
export const REFERENCES: [BackupTable, string, BackupTable][] = [
  ['date_exceptions', 'term_id', 'terms'],
  ['workstreams', 'term_id', 'terms'],
  ['topics', 'workstream_id', 'workstreams'],
  ['commitments', 'term_id', 'terms'],
  ['commitments', 'workstream_id', 'workstreams'],
  ['commitment_changes', 'commitment_id', 'commitments'],
  ['assessments', 'term_id', 'terms'],
  ['assessments', 'workstream_id', 'workstreams'],
  ['study_templates', 'term_id', 'terms'],
  ['study_templates', 'workstream_id', 'workstreams'],
  ['study_templates', 'depends_on_commitment_id', 'commitments'],
  ['sessions', 'term_id', 'terms'],
  ['sessions', 'workstream_id', 'workstreams'],
  ['sessions', 'template_id', 'study_templates'],
  ['sessions', 'assessment_id', 'assessments'],
  ['sessions', 'moved_from_id', 'sessions'],
  ['timed_sets', 'term_id', 'terms'],
  ['timed_sets', 'workstream_id', 'workstreams'],
  ['timed_sets', 'session_id', 'sessions'],
  ['errors', 'term_id', 'terms'],
  ['errors', 'workstream_id', 'workstreams'],
  ['errors', 'timed_set_id', 'timed_sets'],
  ['retests', 'error_id', 'errors'],
  ['weekly_reviews', 'term_id', 'terms'],
  ['schedule_changes', 'term_id', 'terms'],
];
