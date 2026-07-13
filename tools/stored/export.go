package main

// Disk mirror: after every successful DB mutation, stored replays the change
// to the legacy vault/ tree by calling vaultd — the component that already
// owns filesystem writes. SQLite stays the source of truth; the files are a
// continuously-maintained legacy-format export, which keeps indexd (reads
// files) and Claude Code's /lect flow (writes files) working unchanged
// through the migration.
//
// Mirror failures are logged, never returned: a mutation that committed to
// SQLite is durable, and the next explicit import/export can reconcile disk.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"time"
)

var mirrorClient = &http.Client{Timeout: 5 * time.Second}

func vaultdURL() string {
	if u := os.Getenv("VAULTD_URL"); u != "" {
		return u
	}
	return "http://127.0.0.1:4321"
}

func vaultdCall(method, path string, body any) error {
	var buf *bytes.Buffer
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return err
		}
		buf = bytes.NewBuffer(b)
	} else {
		buf = &bytes.Buffer{}
	}
	req, err := http.NewRequest(method, vaultdURL()+path, buf)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if t := os.Getenv("VAULTD_TOKEN"); t != "" {
		req.Header.Set("X-Auth-Token", t)
	}
	res, err := mirrorClient.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("vaultd %s %s: %d", method, path, res.StatusCode)
	}
	return nil
}

func logMirror(err error, what string) {
	if err != nil {
		log.Printf("mirror: %s: %v", what, err)
	}
}

func mirrorFolderCreate(name string) {
	logMirror(vaultdCall(http.MethodPost, "/folder", map[string]string{"name": name}), "create folder "+name)
}

func mirrorFolderDelete(name string) {
	logMirror(vaultdCall(http.MethodDelete, "/folder/"+url.PathEscape(name), nil), "delete folder "+name)
}

func mirrorDocSave(kind string, in SaveInput) {
	logMirror(vaultdCall(http.MethodPost, "/"+kind, map[string]any{
		"folder": in.FolderSlug, "id": in.DocKey, "slug": in.Slug,
		"title": in.Title, "seq": in.Seq, "html": in.HTML,
	}), "save "+kind+" "+in.FolderSlug+"/"+in.DocKey)
}

func mirrorDocDelete(kind, folder, id string) {
	logMirror(vaultdCall(http.MethodDelete,
		"/"+kind+"/"+url.PathEscape(folder)+"/"+url.PathEscape(id), nil),
		"delete "+kind+" "+folder+"/"+id)
}

func mirrorDocRename(kind, folder, id, newTitle string) {
	logMirror(vaultdCall(http.MethodPost,
		"/"+kind+"/"+url.PathEscape(folder)+"/"+url.PathEscape(id)+"/rename",
		map[string]string{"newTitle": newTitle}),
		"rename "+kind+" "+folder+"/"+id)
}
