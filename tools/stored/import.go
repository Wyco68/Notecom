package main

// Legacy vault importer: scans vault/<folder-slug>/{index.json, *.html} and
// upserts folders + documents into SQLite. Runs automatically on first boot
// (empty DB) so switching the app's runtime from vaultd to stored is
// invisible, and on demand via POST /import.
//
// Semantics:
//   - The first-boot seed does not enqueue sync ops (the queue stays empty
//     after the bulk import); the sync engine's one-time bootstrap pushes
//     that pre-existing content instead.
//   - Every later import DOES enqueue what it actually changed. This is the
//     ingest path for Claude-authored content: /lect writes files, /api/tree
//     imports them, and without tracking a newly generated lesson would live
//     in SQLite and the UI but never reach the other devices.
//   - Idempotent — a document identical on disk and in the DB is skipped, so
//     re-imports don't churn versions/updated_at, and a change pulled from
//     the cloud (already mirrored to disk) never echoes back as an upload.
//   - Disk wins — an explicit re-import overwrites the DB copy (and
//     resurrects a soft-deleted one) when the disk copy differs. That is the
//     point of a user-triggered import; it is why it never runs
//     automatically once the DB is non-empty (the DB is the source of truth
//     from then on).

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

type importEntry struct {
	ID    string `json:"id"`
	Slug  string `json:"slug"`
	Title string `json:"title"`
	Seq   int    `json:"seq"`
}

type importIndex struct {
	Lessons     []importEntry `json:"lessons"`
	Quizzes     []importEntry `json:"quizzes"`
	Assignments []importEntry `json:"assignments"`
}

// parseIndex reads both index.json shapes: the current
// {lessons,quizzes,assignments} object and the legacy bare array (lessons
// only) — same tolerance vaultd has.
func parseIndex(data []byte) (importIndex, error) {
	var idx importIndex
	if err := json.Unmarshal(data, &idx); err == nil {
		return idx, nil
	}
	var legacy []importEntry
	if err := json.Unmarshal(data, &legacy); err != nil {
		return importIndex{}, errors.New("unrecognized index.json shape")
	}
	return importIndex{Lessons: legacy}, nil
}

// htmlFilename maps a kind + folder-local id to its on-disk filename (the
// quiz-/assignment- prefixes are vaultd's collision guard).
func htmlFilename(kind, id string) string {
	switch kind {
	case KindQuiz:
		return "quiz-" + id + ".html"
	case KindAssignment:
		return "assignment-" + id + ".html"
	default:
		return id + ".html"
	}
}

type importStats struct {
	Folders  int `json:"folders"`
	Imported int `json:"imported"`
	Skipped  int `json:"skipped"`
	Errors   int `json:"errors"`
}

func (s *server) importVault(root string, track bool) (importStats, error) {
	var st importStats
	entries, err := os.ReadDir(root)
	if err != nil {
		return st, fmt.Errorf("read vault root: %w", err)
	}
	for _, ent := range entries {
		if !ent.IsDir() || strings.HasPrefix(ent.Name(), ".") {
			continue
		}
		folder := ent.Name()
		if !safeName(folder) {
			continue
		}
		idxPath := filepath.Join(root, folder, "index.json")
		data, err := os.ReadFile(idxPath)
		if err != nil {
			continue // not a vault folder
		}
		idx, err := parseIndex(data)
		if err != nil {
			log.Printf("import: %s: %v", idxPath, err)
			st.Errors++
			continue
		}
		if _, err := s.folders.Create(folder, folder, track); err != nil {
			return st, fmt.Errorf("import folder %s: %w", folder, err)
		}
		st.Folders++
		for kind, list := range map[string][]importEntry{
			KindLesson: idx.Lessons, KindQuiz: idx.Quizzes, KindAssignment: idx.Assignments,
		} {
			for _, e := range list {
				if !safeName(e.ID) {
					log.Printf("import: %s/%s: unsafe id %q", folder, kind, e.ID)
					st.Errors++
					continue
				}
				htmlPath := filepath.Join(root, folder, htmlFilename(kind, e.ID))
				html, err := os.ReadFile(htmlPath)
				if err != nil {
					log.Printf("import: %s: %v", htmlPath, err)
					st.Errors++
					continue
				}
				in := SaveInput{
					FolderSlug: folder, Kind: kind, DocKey: e.ID,
					Slug: e.Slug, Title: e.Title, Seq: e.Seq, HTML: string(html),
				}
				if existing, err := s.docs.GetByKey(folder, kind, e.ID); err == nil &&
					existing.Slug == in.Slug && existing.Title == in.Title &&
					existing.Seq == in.Seq && existing.HTML == in.HTML {
					st.Skipped++
					continue
				}
				if _, err := s.docs.Save(in, track); err != nil {
					return st, fmt.Errorf("import %s/%s/%s: %w", folder, kind, e.ID, err)
				}
				st.Imported++
			}
		}
	}
	return st, nil
}

// importIfEmpty seeds a fresh database from the legacy vault on first boot.
func (s *server) importIfEmpty(root string) {
	var n int
	if err := s.db.sql.QueryRow(`SELECT COUNT(*) FROM folders`).Scan(&n); err != nil {
		log.Printf("import: count folders: %v", err)
		return
	}
	if n > 0 {
		return
	}
	// track=false: the sync bootstrap enqueues this whole seed in one pass.
	st, err := s.importVault(root, false)
	if err != nil {
		log.Printf("import: %v", err)
		return
	}
	log.Printf("import: seeded from %s — %d folders, %d docs (%d skipped, %d errors)",
		root, st.Folders, st.Imported, st.Skipped, st.Errors)
}
