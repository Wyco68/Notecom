package main

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

type database struct {
	sql *sql.DB
}

func openDatabase(path string) (*database, error) {
	db, err := sql.Open("sqlite", "file:"+path+"?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	// modernc/sqlite allows a single writer; one connection removes
	// SQLITE_BUSY races between the sync worker and the HTTP handlers
	// entirely (same choice as indexd's db.go).
	db.SetMaxOpenConns(1)
	if err := migrate(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &database{sql: db}, nil
}

func (d *database) Close() error { return d.sql.Close() }
