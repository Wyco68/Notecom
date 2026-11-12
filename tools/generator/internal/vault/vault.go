// Package vault decrypts a reader's saved AI key: the Go side of
// lib/ai/vault.ts. AES-256-GCM under a key derived (HKDF-SHA256) from
// AI_KEYS_SECRET, with "<owner>|<service>" as the additional data, so a
// ciphertext moved to another row or another reader fails to decrypt. The
// generator only ever decrypts; keys are saved by the app.
package vault

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"strings"
)

// ErrUnreadable is what the reader is told: the key must be saved again.
var ErrUnreadable = errors.New("the saved key can't be read — save it again")

// Vault holds the derived key.
type Vault struct{ key []byte }

// New derives the encryption key from AI_KEYS_SECRET (base64, 32+ bytes).
func New(secretB64 string) (*Vault, error) {
	secret, err := base64.StdEncoding.DecodeString(strings.TrimSpace(secretB64))
	if err != nil || len(secret) < 32 {
		return nil, errors.New("AI_KEYS_SECRET must be 32+ random bytes, base64")
	}
	key, err := hkdf.Key(sha256.New, secret, nil, "notecom ai keys v1", 32)
	if err != nil {
		return nil, err
	}
	return &Vault{key: key}, nil
}

// Decrypt opens "v1:<iv>:<ciphertext>:<tag>" for owner and service.
func (v *Vault) Decrypt(owner, service, stored string) (string, error) {
	parts := strings.Split(stored, ":")
	if len(parts) != 4 || parts[0] != "v1" {
		return "", ErrUnreadable
	}
	iv, err1 := base64.StdEncoding.DecodeString(parts[1])
	body, err2 := base64.StdEncoding.DecodeString(parts[2])
	tag, err3 := base64.StdEncoding.DecodeString(parts[3])
	// A full 16-byte tag only: GCM would otherwise accept a truncated one.
	if err1 != nil || err2 != nil || err3 != nil || len(iv) != 12 || len(tag) != 16 {
		return "", ErrUnreadable
	}
	block, err := aes.NewCipher(v.key)
	if err != nil {
		return "", ErrUnreadable
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", ErrUnreadable
	}
	plain, err := gcm.Open(nil, iv, append(body, tag...), []byte(owner+"|"+service))
	if err != nil {
		return "", ErrUnreadable
	}
	return string(plain), nil
}
