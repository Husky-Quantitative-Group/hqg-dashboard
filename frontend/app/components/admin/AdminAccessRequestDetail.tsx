import { useEffect, useState } from "react";
import { approveAccessRequest, denyAccessRequest, type AccessRequest } from "~/api/admin";

type AdminAccessRequestDetailProps = {
  request?: AccessRequest | null;
  onActionComplete?: () => void;
};

export default function AdminAccessRequestDetail({
  request,
  onActionComplete,
}: AdminAccessRequestDetailProps) {
  const [action, setAction] = useState<"approve" | "deny" | null>(null);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setAction(null);
    setNotes("");
    setError(null);
    setSuccess(null);
    setSubmitting(false);
  }, [request?.netid, request?.created_at]);

  if (!request) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/30 p-6 text-slate-400">
        No access request selected.
      </div>
    );
  }

  const isPending = (request.status ?? "PENDING").toUpperCase() === "PENDING";

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

  const handleConfirm = async () => {
    if (!action || submitting) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      if (action === "approve") {
        await approveAccessRequest(request.netid, notes);
        setSuccess("Approved.");
      } else {
        await denyAccessRequest(request.netid, notes);
        setSuccess("Denied.");
      }
      setAction(null);
      setNotes("");
      onActionComplete?.();
    } catch (err) {
      setError("Failed to submit decision.");
    } finally {
      setSubmitting(false);
    }
  };

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

      <div className="mt-6 border-t border-slate-800 pt-5">
        <div className="text-sm font-semibold text-slate-200">Decision</div>
        {!isPending && (
          <div className="mt-2 text-sm text-slate-400">
            This request has already been decided.
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!isPending || submitting}
            onClick={() => setAction("approve")}
            className={
              "rounded-lg px-3 py-2 text-sm font-medium transition " +
              (action === "approve"
                ? "bg-emerald-500/20 text-emerald-200 ring-1 ring-emerald-500/40"
                : "bg-slate-800 text-slate-300 hover:text-white")
            }
          >
            Approve
          </button>
          <button
            type="button"
            disabled={!isPending || submitting}
            onClick={() => setAction("deny")}
            className={
              "rounded-lg px-3 py-2 text-sm font-medium transition " +
              (action === "deny"
                ? "bg-rose-500/20 text-rose-200 ring-1 ring-rose-500/40"
                : "bg-slate-800 text-slate-300 hover:text-white")
            }
          >
            Deny
          </button>
        </div>

        <div className="mt-4">
          <label className="text-xs uppercase tracking-wide text-slate-500">
            Decision notes
          </label>
          <textarea
            rows={4}
            disabled={!isPending || !action || submitting}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add a short note for the applicant..."
            className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-sm text-slate-200 outline-none placeholder:text-slate-600 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!isPending || !action || submitting}
            onClick={handleConfirm}
            className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-white disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          >
            {submitting
              ? "Submitting..."
              : action === "deny"
              ? "Confirm denial"
              : "Confirm approval"}
          </button>
          {error && <div className="text-sm text-rose-300">{error}</div>}
          {success && <div className="text-sm text-emerald-300">{success}</div>}
        </div>
      </div>
    </div>
  );
}
