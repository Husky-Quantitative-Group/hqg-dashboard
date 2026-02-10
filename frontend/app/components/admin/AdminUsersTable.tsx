import type { AdminUser } from "~/api/admin";

type AdminUsersTableProps = {
  users: AdminUser[];
  selectedNetid?: string | null;
  onSelect: (user: AdminUser) => void;
};

export default function AdminUsersTable({
  users,
  selectedNetid,
  onSelect,
}: AdminUsersTableProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
      <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300">
        Users ({users.length})
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-950/80 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2">NetID</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Roles</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isSelected = user.netid === selectedNetid;
              const roles = Array.isArray(user.roles) ? user.roles.join(", ") : "—";
              return (
                <tr
                  key={user.netid}
                  className={
                    "cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/40 " +
                    (isSelected ? "bg-slate-800/60" : "")
                  }
                  onClick={() => onSelect(user)}
                >
                  <td className="px-4 py-2 font-medium text-slate-100">{user.netid}</td>
                  <td className="px-4 py-2 text-slate-300">{user.full_name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-400">{roles}</td>
                </tr>
              );
            })}
            {!users.length && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  No users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
