package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// scan reconciles the index with the vault on disk: new/changed documents
// are re-chunked and vanished ones are dropped. Hash comparison makes the
// no-change case nearly free, so callers can trigger scans liberally
// (startup, /reindex, tree refresh).
func (s *server) scan() {
	s.scanMu.Lock()
	s.scanning = true
	s.scanMu.Unlock()
	defer func() {
		s.scanMu.Lock()
		s.scanning = false
		s.lastScan = time.Now()
		s.scanMu.Unlock()
	}()

	onDisk := listVault()
	indexed, err := s.db.allDocuments()
	if err != nil {
		log.Printf("scan: read index: %v", err)
		return
	}

	for key, path := range onDisk {
		data, err := os.ReadFile(path)
		if err != nil {
			continue
		}
		sum := sha256.Sum256(data)
		hash := hex.EncodeToString(sum[:])
		if indexed[key] == hash {
			continue
		}
		if err := s.indexDocument(key, string(data), hash); err != nil {
			log.Printf("scan: index %s/%s (%s): %v", key.Folder, key.ID, key.Kind, err)
		}
	}

	for key := range indexed {
		if _, ok := onDisk[key]; !ok {
			if err := s.db.deleteDocument(key.Folder, key.ID, key.Kind); err != nil {
				log.Printf("scan: delete %s/%s (%s): %v", key.Folder, key.ID, key.Kind, err)
			}
		}
	}
}

// indexOne (re)indexes a single document straight from disk.
func (s *server) indexOne(folder, id, kind string) error {
	path := docPath(folder, id, kind)
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s.db.deleteDocument(folder, id, kind)
		}
		return err
	}
	sum := sha256.Sum256(data)
	return s.indexDocument(docKey{folder, id, kind}, string(data), hex.EncodeToString(sum[:]))
}

func (s *server) indexDocument(key docKey, src, hash string) error {
	title, chunks := chunkHTML(src)
	if title == "" {
		title = indexTitle(key)
	}
	return s.db.replaceDocument(key.Folder, key.ID, key.Kind, title, hash, chunks)
}

// --- vault directory layout (mirrors vaultd's storage model) ---

func docPath(folder, id, kind string) string {
	name := id + ".html"
	if kind == "quiz" {
		name = "quiz-" + id + ".html"
	}
	return filepath.Join(vaultRoot(), folder, name)
}

// listVault walks each folder's index.json — the same source of truth the
// reader uses — so stray .html files that aren't registered don't get
// indexed.
func listVault() map[docKey]string {
	out := map[docKey]string{}
	entries, err := os.ReadDir(vaultRoot())
	if err != nil {
		return out
	}
	for _, de := range entries {
		if !de.IsDir() || strings.HasPrefix(de.Name(), ".") {
			continue
		}
		folder := de.Name()
		data, err := os.ReadFile(filepath.Join(vaultRoot(), folder, "index.json"))
		if err != nil {
			continue
		}
		var idx struct {
			Lessons []struct{ ID string } `json:"lessons"`
			Quizzes []struct{ ID string } `json:"quizzes"`
		}
		if err := json.Unmarshal(data, &idx); err != nil {
			// legacy bare-array index.json (lessons only)
			var legacy []struct{ ID string }
			if json.Unmarshal(data, &legacy) != nil {
				continue
			}
			idx.Lessons = legacy
		}
		add := func(id, kind string) {
			if id == "" {
				return
			}
			p := docPath(folder, id, kind)
			if _, err := os.Stat(p); err == nil {
				out[docKey{folder, id, kind}] = p
			}
		}
		for _, l := range idx.Lessons {
			add(l.ID, "lesson")
		}
		for _, q := range idx.Quizzes {
			add(q.ID, "quiz")
		}
	}
	return out
}

func indexTitle(key docKey) string {
	return key.ID
}
