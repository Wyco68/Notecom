"use client";

import { useState } from "react";
import Modal from "./Modal";

export default function NewFolderModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "failed");
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="New Folder" onClose={onClose}>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        Folder name
      </label>
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
        className="ui-field mb-3"
        placeholder="e.g. Wireless Network"
      />
      {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <button
        onClick={create}
        disabled={busy || !name.trim()}
        className="ui-btn ui-btn-primary w-full"
      >
        {busy ? "Creating..." : "Create"}
      </button>
    </Modal>
  );
}
