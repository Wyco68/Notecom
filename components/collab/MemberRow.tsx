"use client";

import TrashIcon from "@/components/icons/TrashIcon";
import RoleBadge from "./RoleBadge";
import type { FolderRole, Member } from "@/lib/collab/types";

// Row-level actions follow the hover-reveal pattern from FileTreeNode: `group`
// on the row, `hidden group-hover:` on the control.
export default function MemberRow({
  member,
  canManage,
  isSelf,
  onRoleChange,
  onRemove,
}: {
  member: Member;
  canManage: boolean;
  isSelf: boolean;
  onRoleChange: (role: FolderRole) => void;
  onRemove: () => void;
}) {
  // The owner's role is structural, not editable — it changes only by
  // transferring or deleting the folder.
  const editable = canManage && member.role !== "owner";

  return (
    <div className="group flex items-center gap-3 rounded px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/10 text-xs font-medium text-gray-600 dark:bg-white/10 dark:text-gray-300">
        {member.username.slice(0, 2).toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm text-gray-900 dark:text-gray-100">
          {member.username}
          {isSelf && <span className="ml-1 text-xs text-gray-400">(you)</span>}
        </div>
      </div>

      {editable ? (
        <select
          value={member.role}
          onChange={(e) => onRoleChange(e.target.value as FolderRole)}
          className="rounded border border-black/10 bg-gray-50 px-2 py-1 text-xs text-gray-900 outline-none focus:border-blue-500 dark:border-white/10 dark:bg-[#0d1117] dark:text-gray-100"
        >
          <option value="viewer">viewer</option>
          <option value="editor">editor</option>
        </select>
      ) : (
        <RoleBadge role={member.role} />
      )}

      {editable && (
        <button
          onClick={onRemove}
          className="hidden h-5 w-5 shrink-0 items-center justify-center rounded text-gray-500 hover:bg-red-500/10 hover:text-red-400 group-hover:flex"
          aria-label={`Remove ${member.username}`}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
