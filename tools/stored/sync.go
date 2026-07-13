package main

// Background sync engine. Runs entirely inside stored, never in UI code:
//
//	local mutation → sync_queue (already committed, see enqueue)
//	every 30s      → pull (remote-newer rows → SQLite, LWW) then
//	                 push (queued rows → Supabase, batched upserts)
//	on shutdown    → one final push
//
// "On reconnect" needs no special case: a cycle that fails on a dead network
// leaves the queue intact with backoff gates, and the next tick after the
// network returns drains it.
//
// Deletes are tombstones (deleted=true rows), so push is upserts only. The
// worker reads the live row at push time, which collapses any burst of edits
// to one upload of the final state — never one upload per keystroke.

import (
	"log"
	"time"
)

const (
	pushBatchLimit = 200
	pullPageLimit  = 500
	syncInterval   = 30 * time.Second
	backoffBase    = 30 * time.Second
	backoffMax     = time.Hour
)

type remoteFolder struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	Version   int    `json:"version"`
	Deleted   bool   `json:"deleted"`
	SyncedAt  string `json:"synced_at,omitempty"` // server-assigned; never sent
}

type remoteDocument struct {
	ID        string `json:"id"`
	FolderID  string `json:"folder_id"`
	Kind      string `json:"kind"`
	DocKey    string `json:"doc_key"`
	Slug      string `json:"slug"`
	Title     string `json:"title"`
	Seq       int    `json:"seq"`
	HTML      string `json:"html"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	Version   int    `json:"version"`
	Deleted   bool   `json:"deleted"`
	SyncedAt  string `json:"synced_at,omitempty"`
}

// normalizeTS re-formats any RFC3339 timestamp (Postgres returns +00:00
// offsets) to the DB-wide UTC RFC3339Nano form so string comparisons stay
// chronological across locally- and remotely-written rows.
func normalizeTS(s string) string {
	t, err := time.Parse(time.RFC3339Nano, s)
	if err != nil {
		return s
	}
	return t.UTC().Format(time.RFC3339Nano)
}

func (s *server) syncLoop(sb *supabaseClient, stop <-chan struct{}) {
	s.bootstrapOnce()
	cycle := func() {
		if err := s.pull(sb); err != nil {
			log.Printf("sync: pull: %v", err)
		}
		if err := s.push(sb); err != nil {
			log.Printf("sync: push: %v", err)
		}
	}
	cycle()
	tick := time.NewTicker(syncInterval)
	defer tick.Stop()
	for {
		select {
		case <-tick.C:
			cycle()
		case <-stop:
			if err := s.push(sb); err != nil { // final flush; queue survives failure
				log.Printf("sync: final push: %v", err)
			}
			return
		}
	}
}

// bootstrapOnce queues every existing row the first time sync is enabled —
// content imported before sync existed never enqueued anything.
func (s *server) bootstrapOnce() {
	if v, ok := s.sync.getSetting("sync.bootstrapped"); ok && v == "1" {
		return
	}
	s.mu.Lock()
	n, err := s.bootstrapEnqueueAll()
	s.mu.Unlock()
	if err != nil {
		log.Printf("sync: bootstrap: %v", err)
		return
	}
	if err := s.sync.setSetting("sync.bootstrapped", "1"); err != nil {
		log.Printf("sync: bootstrap flag: %v", err)
		return
	}
	log.Printf("sync: bootstrap queued %d existing records", n)
}

// --- push ---

func (s *server) push(sb *supabaseClient) error {
	items, err := s.sync.pending(pushBatchLimit)
	if err != nil || len(items) == 0 {
		return err
	}
	// Collapse to one upload per record: the newest local state is read once,
	// and every queue row for that record resolves together.
	type group struct{ queueIDs []int64 }
	byRecord := map[string]map[string]*group{"folders": {}, "documents": {}}
	for _, it := range items {
		m := byRecord[it.TableName]
		if m == nil {
			continue
		}
		g := m[it.RecordID]
		if g == nil {
			g = &group{}
			m[it.RecordID] = g
		}
		g.queueIDs = append(g.queueIDs, it.ID)
	}

	resolve := func(ids []int64, ok bool, retry int) {
		for _, id := range ids {
			if ok {
				if err := s.sync.remove(id); err != nil {
					log.Printf("sync: dequeue %d: %v", id, err)
				}
			} else {
				d := backoffBase << uint(min(retry, 7))
				if d > backoffMax {
					d = backoffMax
				}
				if err := s.sync.defer_(id, time.Now().UTC().Add(d).Format(time.RFC3339Nano)); err != nil {
					log.Printf("sync: defer %d: %v", id, err)
				}
			}
		}
	}
	maxRetry := 0
	for _, it := range items {
		if it.RetryCount > maxRetry {
			maxRetry = it.RetryCount
		}
	}

	// Folders first so a brand-new folder exists remotely before its docs.
	var folderRows []remoteFolder
	var folderQueue []int64
	for id, g := range byRecord["folders"] {
		f, err := s.folders.GetByID(id)
		if err != nil {
			resolve(g.queueIDs, true, 0) // row gone — nothing to upload
			continue
		}
		folderRows = append(folderRows, remoteFolder{
			ID: f.ID, Slug: f.Slug, Name: f.Name, CreatedAt: f.CreatedAt,
			UpdatedAt: f.UpdatedAt, Version: f.Version, Deleted: f.Deleted,
		})
		folderQueue = append(folderQueue, g.queueIDs...)
	}
	if len(folderRows) > 0 {
		err := sb.upsert("notes_folders", folderRows)
		resolve(folderQueue, err == nil, maxRetry)
		if err != nil {
			return err
		}
	}

	var docRows []remoteDocument
	var docQueue []int64
	for id, g := range byRecord["documents"] {
		d, err := s.docs.GetByID(id)
		if err != nil {
			resolve(g.queueIDs, true, 0)
			continue
		}
		docRows = append(docRows, remoteDocument{
			ID: d.ID, FolderID: d.FolderID, Kind: d.Kind, DocKey: d.DocKey,
			Slug: d.Slug, Title: d.Title, Seq: d.Seq, HTML: d.HTML,
			CreatedAt: d.CreatedAt, UpdatedAt: d.UpdatedAt, Version: d.Version, Deleted: d.Deleted,
		})
		docQueue = append(docQueue, g.queueIDs...)
	}
	if len(docRows) > 0 {
		err := sb.upsert("notes_documents", docRows)
		resolve(docQueue, err == nil, maxRetry)
		if err != nil {
			return err
		}
	}
	log.Printf("sync: pushed %d folders, %d documents", len(folderRows), len(docRows))
	return nil
}

// --- pull ---

func (s *server) pull(sb *supabaseClient) error {
	if err := s.pullFolders(sb); err != nil {
		return err
	}
	return s.pullDocuments(sb)
}

func (s *server) pullFolders(sb *supabaseClient) error {
	cursor, _ := s.sync.getSetting("sync.cursor.notes_folders")
	for {
		var rows []remoteFolder
		if err := sb.pullSince("notes_folders", cursor, pullPageLimit, &rows); err != nil {
			return err
		}
		for _, r := range rows {
			f := &Folder{
				ID: r.ID, Slug: r.Slug, Name: r.Name,
				CreatedAt: normalizeTS(r.CreatedAt), UpdatedAt: normalizeTS(r.UpdatedAt),
				Version: r.Version, Deleted: r.Deleted,
			}
			s.mu.Lock()
			changed, err := s.folders.ApplyRemote(f)
			s.mu.Unlock()
			if err != nil {
				log.Printf("sync: apply folder %s: %v", r.ID, err)
			} else if changed {
				if f.Deleted {
					mirrorFolderDelete(f.Slug)
				} else {
					mirrorFolderCreate(f.Slug)
				}
			}
			cursor = r.SyncedAt
		}
		if len(rows) > 0 {
			if err := s.sync.setSetting("sync.cursor.notes_folders", cursor); err != nil {
				return err
			}
			s.markSynced()
		}
		if len(rows) < pullPageLimit {
			return nil
		}
	}
}

func (s *server) pullDocuments(sb *supabaseClient) error {
	cursor, _ := s.sync.getSetting("sync.cursor.notes_documents")
	for {
		var rows []remoteDocument
		if err := sb.pullSince("notes_documents", cursor, pullPageLimit, &rows); err != nil {
			return err
		}
		for _, r := range rows {
			d := &Document{
				ID: r.ID, FolderID: r.FolderID, Kind: r.Kind, DocKey: r.DocKey,
				Slug: r.Slug, Title: r.Title, Seq: r.Seq, HTML: r.HTML,
				CreatedAt: normalizeTS(r.CreatedAt), UpdatedAt: normalizeTS(r.UpdatedAt),
				Version: r.Version, Deleted: r.Deleted,
			}
			// The folder must exist locally (FK); folder rows are pulled
			// first and are created before their docs chronologically, so a
			// miss here is a genuine anomaly worth logging, not handling.
			folder, err := s.folders.GetByID(d.FolderID)
			if err != nil {
				log.Printf("sync: document %s references unknown folder %s — skipped", d.ID, d.FolderID)
				cursor = r.SyncedAt
				continue
			}
			s.mu.Lock()
			changed, err := s.docs.ApplyRemote(d)
			s.mu.Unlock()
			if err != nil {
				log.Printf("sync: apply document %s: %v", r.ID, err)
			} else if changed {
				if d.Deleted {
					mirrorDocDelete(d.Kind, folder.Slug, d.DocKey)
				} else {
					mirrorDocSave(d.Kind, SaveInput{
						FolderSlug: folder.Slug, Kind: d.Kind, DocKey: d.DocKey,
						Slug: d.Slug, Title: d.Title, Seq: d.Seq, HTML: d.HTML,
					})
				}
			}
			cursor = r.SyncedAt
		}
		if len(rows) > 0 {
			if err := s.sync.setSetting("sync.cursor.notes_documents", cursor); err != nil {
				return err
			}
			s.markSynced()
		}
		if len(rows) < pullPageLimit {
			return nil
		}
	}
}

func (s *server) markSynced() {
	if err := s.sync.setLastSync(nowISO()); err != nil {
		log.Printf("sync: last_sync: %v", err)
	}
}
