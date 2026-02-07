import type { AccessRequest } from "~/api/admin";

type AdminAccessRequestsTableProps = {
  requests: AccessRequest[];
  selectedNetid?: string | null;
  onSelect: (request: AccessRequest) => void;
};

export default function AdminAccessRequestsTable({
  requests,
  selectedNetid,
  onSelect,
}: AdminAccessRequestsTableProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40">
      <div className="px-4 py-3 border-b border-slate-800 text-sm text-slate-300">
        Access Requests ({requests.length})
      </div>
      <div className="max-h-[70vh] overflow-auto">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-slate-950/80 text-xs uppercase text-slate-400">
            <tr>
              <th className="px-4 py-2">NetID</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => {
              const isSelected = request.netid === selectedNetid;
              return (
                <tr
                  key={`${request.netid}-${request.created_at ?? ""}`}
                  className={
                    "cursor-pointer border-t border-slate-800/60 hover:bg-slate-800/40 " +
                    (isSelected ? "bg-slate-800/60" : "")
                  }
                  onClick={() => onSelect(request)}
                >
                  <td className="px-4 py-2 font-medium text-slate-100">{request.netid}</td>
                  <td className="px-4 py-2 text-slate-300">{request.full_name ?? "—"}</td>
                  <td className="px-4 py-2 text-slate-400">{request.status ?? "pending"}</td>
                </tr>
              );
            })}
            {!requests.length && (
              <tr>
                <td className="px-4 py-6 text-slate-500" colSpan={3}>
                  No access requests found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
