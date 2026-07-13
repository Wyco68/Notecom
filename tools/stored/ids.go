package main

import (
	"crypto/rand"
	"fmt"
	"strings"
	"time"
)

// newID returns a random UUIDv4 as the canonical 36-char string. Row
// identity must be device-independent for cross-device sync, so ids are
// random, never derived from a local sequence.
func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err) // crypto/rand failure is unrecoverable
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

// nowISO is the single timestamp format for the whole DB: UTC RFC3339 with
// nanoseconds, so string ordering equals chronological ordering (the pull
// cursor and LWW comparisons rely on that).
func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339Nano)
}

// safeName rejects any folder/doc identifier that could escape the intended
// key space (path separators, traversal, control chars). Same boundary rule
// as vaultd/indexd: validate every id that arrives from a request.
func safeName(s string) bool {
	if s == "" || len(s) > 200 {
		return false
	}
	if strings.ContainsAny(s, "/\\") || strings.Contains(s, "..") {
		return false
	}
	for _, r := range s {
		if r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}
