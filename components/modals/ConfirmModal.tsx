"use client";

import Modal from "./Modal";

export default function ConfirmModal({
  title,
  message,
  confirmLabel = "Delete",
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="mb-5 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{message}</p>
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} disabled={busy} className="ui-btn ui-btn-sm ui-btn-ghost">
          Cancel
        </button>
        <button
          onClick={onConfirm}
          disabled={busy}
          className="ui-btn ui-btn-sm ui-btn-danger"
        >
          {busy ? "Deleting..." : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
