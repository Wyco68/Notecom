"use client";

import { useState } from "react";
import Modal from "./Modal";

export default function RenameModal({
  title,
  label,
  initialValue,
  onRename,
  onCancel,
}: {
  title: string;
  label: string;
  initialValue: string;
  onRename: (value: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!value.trim() || value.trim() === initialValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onRename(value.trim());
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={title} onClose={onCancel}>
      <label className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </label>
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        onFocus={(e) => e.currentTarget.select()}
        className="ui-field mb-3"
      />
      {error && <p className="mb-3 text-xs text-red-600 dark:text-red-400">{error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="ui-btn ui-btn-sm ui-btn-ghost">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={busy || !value.trim() || value.trim() === initialValue.trim()}
          className="ui-btn ui-btn-sm ui-btn-primary"
        >
          {busy ? "Renaming..." : "Rename"}
        </button>
      </div>
    </Modal>
  );
}
