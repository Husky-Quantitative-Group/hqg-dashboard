import type { AccessRequest } from "~/api/admin";

type AdminAccessRequestDetailProps = {
  request?: AccessRequest | null;
};

export default function AdminAccessRequestDetail({ request }: AdminAccessRequestDetailProps) {
  if (!request) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-slate-400">
        No access request selected.
      </div>
    );
  }

  const rows: Array<[string, string]> = [
    ["NetID", request.netid],
    ["Name", request.full_name ?? "—"],
    ["Email", request.uconn_email ?? "—"],
    ["Status", request.status ?? "pending"],
    ["Created", request.created_at ?? "—"],
    ["Discord", request.discord_username ?? "—"],
    ["LinkedIn", request.linkedin_url ?? "—"],
    ["GitHub", request.github_url ?? "—"],
    ["Decision Notes", request.decision_notes ?? "—"],
    ["Decided At", request.decided_at ?? "—"],
    ["Decided By", request.decided_by ?? "—"],
  ];

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="text-lg font-semibold text-slate-100">Access request</div>
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
