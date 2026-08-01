"use client";

import TrashIcon from "@/components/icons/TrashIcon";
import Avatar from "./Avatar";
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
    <div className="group flex items-center gap-3 rounded px-2 py-2 transition-colors duration-150 ease-out hover:bg-black/[0.04] dark:hover:bg-white/[0.06]">
      <Avatar username={member.username} avatarUrl={member.avatarUrl} />
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
          className="ui-field w-auto shrink-0 px-2 py-1 text-xs"
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
          className="ui-icon-btn ui-icon-btn-danger ui-reveal h-5 w-5"
          aria-label={`Remove ${member.username}`}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
