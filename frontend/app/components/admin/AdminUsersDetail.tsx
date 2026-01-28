import type { AdminUser } from "~/api/admin";

type AdminUsersDetailProps = {
  user?: AdminUser | null;
};

export default function AdminUsersDetail({ user }: AdminUsersDetailProps) {
  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-slate-400">
        No user selected.
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    ["NetID", user.netid],
    ["Name", user.full_name ?? "—"],
    ["Email", user.uconn_email ?? "—"],
    ["Roles", Array.isArray(user.roles) ? user.roles.join(", ") : "—"],
    ["Banned", user.is_banned ? "Yes" : "No"],
    ["Joined", user.joined_at ?? "—"],
    ["Notes", user.notes ?? "—"],
  ];

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="text-lg font-semibold text-slate-100">User details</div>
      <div className="mt-4 grid gap-3">
        {rows.map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1">
            <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
            <div className="text-sm text-slate-200 break-words">{value}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
