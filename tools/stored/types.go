package main

// Kind values for documents. Lessons and quizzes share a folder but sequence
// independently — the same model vaultd stores on disk.
const (
	KindLesson = "lesson"
	KindQuiz   = "quiz"
)

// Roles are defined by the database (notes_folder_roles); these constants are
// only for the local can-write test that decides whether to push a folder's
// changes. The server remains the authority — a wrong guess here produces a
// 403, not an unauthorized write.
const (
	RoleOwner  = "owner"
	RoleEditor = "editor"
	RoleViewer = "viewer"
)

type Folder struct {
	ID           string `json:"id"`
	Slug         string `json:"slug"`
	Name         string `json:"name"`
	OwnerID      string `json:"owner_id,omitempty"`
	Description  string `json:"description,omitempty"`
	Visibility   string `json:"visibility"`
	Discoverable bool   `json:"discoverable"`
	JoinPolicy   string `json:"join_policy"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
	Version      int    `json:"version"`
	Deleted      bool   `json:"deleted"`
	// Role is the signed-in user's role for this folder, joined from
	// folder_access. Empty on a fully-local install.
	Role string `json:"role,omitempty"`
}

// CanWrite reports whether the cached role permits document writes. Viewer is
// the only role that cannot; an unknown/empty role means "not synced yet",
// which is treated as writable so a local-only install is never blocked.
func (f *Folder) CanWrite() bool { return f.Role != RoleViewer }

type Document struct {
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
}
