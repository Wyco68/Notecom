package main

// Kind values for documents. Lessons, quizzes and assignments share a folder
// but sequence independently — the same three-kind model vaultd stores on disk.
const (
	KindLesson     = "lesson"
	KindQuiz       = "quiz"
	KindAssignment = "assignment"
)

type Folder struct {
	ID        string `json:"id"`
	Slug      string `json:"slug"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
	UpdatedAt string `json:"updated_at"`
	Version   int    `json:"version"`
	Deleted   bool   `json:"deleted"`
}

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
