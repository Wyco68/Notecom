package vault

import (
	"strings"
	"testing"

	"notecom/generator/internal/parity"
)

func TestDecryptsWhatTheAppEncrypted(t *testing.T) {
	v := parity.Load().Vault
	vlt, err := New(v.Secret)
	if err != nil {
		t.Fatal(err)
	}
	got, err := vlt.Decrypt(v.Owner, v.Service, v.Stored)
	if err != nil || got != v.Plain {
		t.Fatalf("Decrypt = %q, %v; want %q", got, err, v.Plain)
	}
	// Bound to its row: another owner or service can't open it.
	if _, err := vlt.Decrypt("someone-else", v.Service, v.Stored); err == nil {
		t.Fatal("decrypted under another owner")
	}
	if _, err := vlt.Decrypt(v.Owner, "openai", v.Stored); err == nil {
		t.Fatal("decrypted under another service")
	}
	// A truncated tag is refused, not accepted.
	parts := strings.Split(v.Stored, ":")
	parts[3] = parts[3][:8]
	if _, err := vlt.Decrypt(v.Owner, v.Service, strings.Join(parts, ":")); err == nil {
		t.Fatal("accepted a short tag")
	}
}

func TestNeedsALongSecret(t *testing.T) {
	if _, err := New("c2hvcnQ="); err == nil {
		t.Fatal("accepted a short secret")
	}
}
