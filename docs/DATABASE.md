# Database

One SQLite database (`studyplanner` on Android, via @capacitor-community/sqlite,
unencrypted, app-private storage). The browser preview uses sql.js with the same
schema. The schema lives in `src/data/schema.ts`; all reads and writes go through
`src/data/repo.ts`.

## Conventions

- IDs are stable text keys. Generated sessions use `${templateId}:${date}`, and
  rows from a bundled package use `${packageId}:${key}`, so re-running generation or
  re-importing never duplicates (`INSERT OR IGNORE` plus `UNIQUE(template_id, date)`).
- Dates are `YYYY-MM-DD`, times `HH:MM` (24 h), timestamps ISO 8601. Weekdays are
  0 = Sunday … 6 = Saturday.
- Booleans are `INTEGER` 0/1. Rules are JSON in `terms.rules_json`.
- Writes are serialised. A nested write joins the outer transaction.

## Tables

| Table | Purpose | Key columns |
| --- | --- | --- |
| `meta` | App state: `schema_version`, `active_term_id`, `package:<id>` import flags, `reduce_scope:*`, `optional_added:*`, `pre_migration_backup`, `pre_import_backup` | `key`, `value` |
| `terms` | A semester: dates, status (`upcoming`, `current`, `archived`), timezone, rules | `id` |
| `date_exceptions` | Holidays, exam windows, recess, overrides. `cancels_classes` removes classes; `suppresses_study` stops template blocks | `term_id`, `start_date`, `end_date` |
| `workstreams` | Courses, labs, research, skills, habits, projects. `term_id` NULL means it spans semesters. Weekly minimum / target / extension minutes, priority, deadline | `id`, `type`, `code` |
| `topics` | Optional topic list per workstream (used by Practice) | `workstream_id` |
| `commitments` | Fixed recurring items (classes, labs, travel, work): weekdays, times, valid range | `term_id` |
| `commitment_changes` | One-off changes to a commitment: `cancelled` (occurrence removed) or `makeup` (extra occurrence) | `UNIQUE(commitment_id, date, kind)` |
| `assessments` | Exams, quizzes, deadlines with optional times; `confirmed` flag | `term_id`, `date` |
| `study_templates` | Weekly study blocks: weekday, start, duration, tier (`core`/`optional`), active flag, valid range, optional dependency on a class | `term_id` |
| `sessions` | Concrete blocks on dates. `status`: `planned`, `done`, `partial`, `missed`, `cancelled`, `moved`, `dropped`. `origin`: `template`, `manual`, `replan`, `seed`. `moved_from_id` links a moved block to its original. `reason` explains replan or cancellation | `UNIQUE(template_id, date)`, index `(term_id, date)` |
| `checkins` | One row per day: sleep hours, focus 1–5, low-energy flag, note | `date` |
| `timed_sets` | Attempted, correct, minutes, target, topic | `workstream_id`, `date` |
| `errors` | Error log: question, category, cause, correction rule, similar question, status (`open`, `mastered`, `retired`) | `workstream_id` |
| `retests` | Due date, label, done date, outcome (`pass`, `assisted`, `fail`) | `error_id`, index `due_date` |
| `weekly_reviews` | Saved weekly review: decision, notes, metrics snapshot | `UNIQUE(term_id, week_start)` |
| `schedule_changes` | "What changed" log written by Replan and edits | `term_id`, `date` |
| `notification_map` | Reminder ID → session and fingerprint, to avoid duplicate reminders | `id` |

`meta` and `notification_map` are device state and are not included in backups.

## Migrations

| Version | Change |
| --- | --- |
| 1 | Initial semester-independent schema (all tables above except `notification_map`) |
| 2 | `sessions.reason`; `notification_map`; index `idx_retests_due` |

On start, `Repo.init()` reads `meta.schema_version`:

1. Equal to the latest: nothing happens.
2. Older: a full JSON snapshot is stored in `meta.pre_migration_backup`, then each
   missing migration runs inside one transaction. Migrations only add tables,
   columns or indexes. They never drop or rewrite user data.
3. Newer (a database from a later app version): the app stops with a message and
   changes nothing (`DowngradeError`).

To add a migration, append `{ version: 3, description, statements }` to
`MIGRATIONS`, update `COLUMNS` for any new backup column, and extend
`upgradeBackup()` in `src/data/backup.ts` so older backup files still import.

## Semesters and archiving

- **Create**: the 6-step wizard (name and dates with holidays, courses and labs,
  class times, exams and deadlines, research and skills, rules) or a term package JSON.
- **Copy from an earlier semester** (wizard option): copies the rules (with the trial
  cleared and optional blocks off) and the long-running workstreams such as research,
  skills and habits. Courses, labs, timetable and logged history are not copied,
  because they change each semester.
- **Archive**: sets `status = 'archived'`. Nothing is deleted. Archived terms stay
  readable and can be restored to current.
- **Switch**: changes `meta.active_term_id`. Other terms are untouched.

## Counting rules

- Completion = (done + partial × `partialWeight`) ÷ scheduled core blocks.
  `partialWeight` defaults to 0.5 and is editable.
- Not in the denominator: `cancelled`, `dropped`, `moved` (the moved copy is counted
  instead).
- A past `planned` block counts as missed ("not logged"). Future blocks are ignored.
- A completed make-up replaces the original missed block.
- Accuracy = correct ÷ attempted; `null` (shown as "–") when attempted is 0 or empty.

## Backup file

```json
{
  "format": "study-planner-backup",
  "formatVersion": 1,
  "schemaVersion": 2,
  "appVersion": "1.0.0",
  "exportedAt": "2030-10-20T12:00:00.000Z",
  "activeTermId": "…",
  "counts": { "terms": 1, … },
  "tables": { "terms": [ … ], "sessions": [ … ], … }
}
```

Import checks the format, required columns, enum values, date and time formats,
references between tables, duplicate IDs, rule values and the active term. Any error
rejects the whole file with a list of problems. Valid files show a preview of row
counts first. The restore runs in one transaction. The data it replaced is kept in
`meta.pre_import_backup` until you undo or import again.
