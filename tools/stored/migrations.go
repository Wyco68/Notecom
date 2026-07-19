package main

// Schema migrations, applied in order by PRAGMA user_version.
//
// The primary database. Unlike indexd's index.db (derived, safe to delete),
// this is the live source of truth once the app runs on SQLite, so every
// schema change is an append-only migration — never edit an existing one.
//
// Design notes that differ from the /feat mega-spec's minimal sketch, kept
// to avoid removing existing features:
//   - documents (not "lessons"): this vault has two doc kinds that share a
//     folder — lesson, quiz — each with its own seq sequence.
//   - doc_key + seq: the app's URLs, filenames and legacy vault export all
//     depend on the "NN-slug" folder-local id and 1-based ordering. Dropping
//     them would break routing and export, so they stay first-class columns.
//   - TEXT UUID primary keys: sync is cross-device Last-Write-Wins, so a row
//     identity must be device-independent. INTEGER autoincrement ids would
//     collide between two machines syncing to the same Supabase project.
//   - version + updated_at on folders and documents: the LWW conflict unit.
//   - deleted flag (soft delete): a hard delete can't propagate through the
//     sync queue to other devices; tombstones can.

import (
	"database/sql"
	"fmt"
)

type migration struct {
	version int
	sql     string
}

var migrations = []migration{
	{
		version: 1,
		sql: `
CREATE TABLE folders (
  id         TEXT PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  deleted    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE documents (
  id         TEXT PRIMARY KEY,
  folder_id  TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,            -- lesson | quiz
  doc_key    TEXT NOT NULL,            -- folder-local id, e.g. "01-intro"
  slug       TEXT NOT NULL,
  title      TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  html       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  deleted    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(folder_id, kind, doc_key)
);

CREATE INDEX documents_folder ON documents(folder_id);
CREATE INDEX documents_updated ON documents(updated_at);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One append-only row per local mutation, drained by the sync worker.
-- record_id points at folders.id or documents.id; the worker reads the live
-- row at upload time (so a burst of edits uploads the latest, not each keystroke).
CREATE TABLE sync_queue (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  table_name   TEXT NOT NULL,          -- "folders" | "documents"
  record_id    TEXT NOT NULL,
  operation    TEXT NOT NULL,          -- "upsert" | "delete"
  retry_count  INTEGER NOT NULL DEFAULT 0,
  next_attempt TEXT NOT NULL,          -- ISO8601; backoff gate
  created_at   TEXT NOT NULL
);

CREATE INDEX sync_queue_ready ON sync_queue(next_attempt);

-- Single-row cursor for the pull side (id pinned to 1).
CREATE TABLE sync_state (
  id        INTEGER PRIMARY KEY CHECK (id = 1),
  last_sync TEXT
);
INSERT INTO sync_state (id, last_sync) VALUES (1, NULL);
`,
	},
}

// migrate applies any migrations whose version is above the DB's current
// PRAGMA user_version, each in its own transaction, then bumps user_version.
func migrate(db *sql.DB) error {
	var current int
	if err := db.QueryRow("PRAGMA user_version").Scan(&current); err != nil {
		return fmt.Errorf("read user_version: %w", err)
	}
	for _, m := range migrations {
		if m.version <= current {
			continue
		}
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		if _, err := tx.Exec(m.sql); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d: %w", m.version, err)
		}
		// PRAGMA can't be parameterized; version is our own trusted int.
		if _, err := tx.Exec(fmt.Sprintf("PRAGMA user_version = %d", m.version)); err != nil {
			tx.Rollback()
			return fmt.Errorf("migration %d bump: %w", m.version, err)
		}
		if err := tx.Commit(); err != nil {
			return err
		}
	}
	return nil
}
