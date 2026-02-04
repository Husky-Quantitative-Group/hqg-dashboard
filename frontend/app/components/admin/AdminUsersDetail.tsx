import { useEffect, useMemo, useState } from "react";
import { patchAdminUser, type AdminUser } from "~/api/admin";

type AdminUsersDetailProps = {
  user?: AdminUser | null;
  loading?: boolean;
  onSaveComplete?: (user: AdminUser) => void;
};

export default function AdminUsersDetail({
  user,
  loading,
  onSaveComplete,
}: AdminUsersDetailProps) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    full_name: "",
    uconn_email: "",
    discord_username: "",
    linkedin_url: "",
    github_url: "",
    roles: [] as string[],
    is_banned: false,
    notes: "",
  });

  useEffect(() => {
    if (!user) return;
    setForm({
      full_name: user.full_name ?? "",
      uconn_email: user.uconn_email ?? "",
      discord_username: user.discord_username ?? "",
      linkedin_url: user.linkedin_url ?? "",
      github_url: user.github_url ?? "",
      roles: Array.isArray(user.roles) ? user.roles : [],
      is_banned: Boolean(user.is_banned),
      notes: user.notes ?? "",
    });
    setEditing(false);
    setError(null);
    setSaving(false);
  }, [user?.netid]);

  const roleSet = useMemo(() => new Set(form.roles), [form.roles]);
  const toggleRole = (role: string) => {
    const next = new Set(roleSet);
    if (next.has(role)) {
      next.delete(role);
    } else {
      next.add(role);
    }
    setForm((prev) => ({ ...prev, roles: Array.from(next) }));
  };

  const handleSave = async () => {
    if (!user || saving) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await patchAdminUser(user.netid, form);
      setEditing(false);
      onSaveComplete?.(updated);
    } catch (err) {
      setError("Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/30 p-6 text-slate-400">
        Loading user...
      </div>
    );
  }
  if (!user) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-slate-400">
        No user selected.
      </div>
    );
  }

  if (editing) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold text-slate-100">Edit user</div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-300 transition hover:text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-lg bg-slate-200 px-3 py-2 text-xs font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
          </div>
        </div>

        {error && <div className="mt-3 text-sm text-rose-300">{error}</div>}

        <div className="mt-5 grid gap-4">
          <label className="text-xs uppercase tracking-wide text-slate-500">
            Full name
            <input
              value={form.full_name}
              onChange={(event) => setForm((prev) => ({ ...prev, full_name: event.target.value }))}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-500">
            UConn email
            <input
              value={form.uconn_email}
              onChange={(event) => setForm((prev) => ({ ...prev, uconn_email: event.target.value }))}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-500">
            Discord username
            <input
              value={form.discord_username}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, discord_username: event.target.value }))
              }
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-500">
            LinkedIn URL
            <input
              value={form.linkedin_url}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, linkedin_url: event.target.value }))
              }
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none"
            />
          </label>
          <label className="text-xs uppercase tracking-wide text-slate-500">
            GitHub URL
            <input
              value={form.github_url}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, github_url: event.target.value }))
              }
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none"
            />
          </label>

          <div className="text-xs uppercase tracking-wide text-slate-500">
            Roles
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              {["MEMBER", "ADMIN"].map((role) => (
                <button
                  key={role}
                  type="button"
                  onClick={() => toggleRole(role)}
                  className={
                    "rounded-lg px-3 py-2 text-xs font-semibold transition " +
                    (roleSet.has(role)
                      ? "bg-slate-200 text-slate-900"
                      : "bg-slate-900 text-slate-300 hover:text-white")
                  }
                >
                  {role}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={form.is_banned}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, is_banned: event.target.checked }))
              }
              className="h-4 w-4 rounded border-slate-700 bg-slate-900 text-slate-200"
            />
            Banned
          </label>

          <label className="text-xs uppercase tracking-wide text-slate-500">
            Notes
            <textarea
              rows={4}
              value={form.notes}
              onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none"
            />
          </label>
        </div>
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
      <div className="flex items-center justify-between">
        <div className="text-lg font-semibold text-slate-100">User details</div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs font-medium text-slate-300 transition hover:text-white"
        >
          Edit
        </button>
      </div>
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
