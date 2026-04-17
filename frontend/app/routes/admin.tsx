import { useEffect, useState } from "react";
import {
  fetchAdminAnalytics,
  fetchAdminAccessRequests,
  fetchAdminUser,
  fetchAdminUserAnalytics,
  fetchAdminUsers,
  type AccessRequest,
  type AdminGlobalAnalytics,
  type AdminUserAnalytics,
  type AdminUser,
} from "~/api/admin";
import AdminUsersTable from "~/components/admin/AdminUsersTable";
import AdminUsersDetail from "~/components/admin/AdminUsersDetail";
import AdminAccessRequestsTable from "~/components/admin/AdminAccessRequestsTable";
import AdminAccessRequestDetail from "~/components/admin/AdminAccessRequestDetail";
import { useUser } from "~/context/UserConext";

const TABS = [
  { id: "users", label: "Users" },
  { id: "access", label: "Access Requests" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export default function AdminPage() {
  const { hasRole } = useUser();
  const isAdmin = hasRole("ADMIN");
  const [tab, setTab] = useState<TabId>("users");
  const [globalAnalytics, setGlobalAnalytics] = useState<AdminGlobalAnalytics | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [selectedUserAnalytics, setSelectedUserAnalytics] = useState<AdminUserAnalytics | null>(null);
  const [selectedRequest, setSelectedRequest] = useState<AccessRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshingUsers, setRefreshingUsers] = useState(false);
  const [refreshingRequests, setRefreshingRequests] = useState(false);
  const [userDetailLoading, setUserDetailLoading] = useState(false);

  useEffect(() => {
    if (!isAdmin) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [analyticsData, usersData, requestsData] = await Promise.all([
          fetchAdminAnalytics(),
          fetchAdminUsers(),
          fetchAdminAccessRequests(),
        ]);
        if (cancelled) return;
        setGlobalAnalytics(analyticsData);
        setUsers(usersData);
        setRequests(requestsData);
      } catch (err) {
        if (cancelled) return;
        setError("Failed to load admin data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  const refreshUsers = async () => {
    if (!isAdmin) return;
    if (refreshingUsers) return;
    setRefreshingUsers(true);
    try {
      const data = await fetchAdminUsers();
      setUsers(data);
      if (selectedUser) {
        const match = data.find((item) => item.netid === selectedUser.netid);
        setSelectedUser(match ?? null);
        if (!match) {
          setSelectedUserAnalytics(null);
        }
      }
    } catch (err) {
      setError("Failed to refresh users.");
    } finally {
      setRefreshingUsers(false);
    }
  };

  const refreshGlobalAnalytics = async () => {
    if (!isAdmin) return;
    try {
      const data = await fetchAdminAnalytics();
      setGlobalAnalytics(data);
    } catch (err) {
      setError("Failed to refresh global analytics.");
    }
  };

  const handleUserSelect = async (user: AdminUser) => {
    if (!isAdmin) return;
    setSelectedUser(user);
    setSelectedUserAnalytics(null);
    setUserDetailLoading(true);
    setError(null);
    try {
      const [detail, analytics] = await Promise.all([
        fetchAdminUser(user.netid),
        fetchAdminUserAnalytics(user.netid),
      ]);
      setSelectedUser(detail);
      setSelectedUserAnalytics(analytics);
    } catch (err) {
      setError("Failed to load user details.");
    } finally {
      setUserDetailLoading(false);
    }
  };

  const refreshRequests = async () => {
    if (!isAdmin) return;
    if (refreshingRequests) return;
    setRefreshingRequests(true);
    try {
      const data = await fetchAdminAccessRequests();
      setRequests(data);
      if (selectedRequest) {
        const match = data.find(
          (item) =>
            item.netid === selectedRequest.netid &&
            item.created_at === selectedRequest.created_at
        );
        setSelectedRequest(match ?? null);
      }
    } catch (err) {
      setError("Failed to refresh access requests.");
    } finally {
      setRefreshingRequests(false);
    }
  };

  if (!isAdmin) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-slate-200">
        You do not have access to the admin console.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {globalAnalytics && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {[
            ["Users", globalAnalytics.total_users],
            ["Strategies", globalAnalytics.total_strategies],
            ["Backtests", globalAnalytics.total_backtests],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
            >
              <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-2 text-3xl font-semibold text-slate-100">{value}</div>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold text-slate-100">Admin</h1>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-1">
          {TABS.map((tabOption) => (
            <button
              key={tabOption.id}
              type="button"
              onClick={() => setTab(tabOption.id)}
              className={
                "px-4 py-2 text-sm font-medium transition rounded-lg " +
                (tab === tabOption.id
                  ? "bg-slate-800 text-white"
                  : "text-slate-400 hover:text-white")
              }
            >
              {tabOption.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-slate-400">
          Loading admin data...
        </div>
      )}

      {!loading && error && (
        <div className="rounded-2xl border border-red-500/40 bg-red-500/10 p-6 text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
          <div>
            {tab === "users" ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-200">Users</div>
                  <button
                    type="button"
                    onClick={refreshUsers}
                    disabled={refreshingUsers}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:text-white"
                  >
                    {refreshingUsers ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <AdminUsersTable
                  users={users}
                  selectedNetid={selectedUser?.netid}
                  onSelect={handleUserSelect}
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold text-slate-200">
                    Access requests
                  </div>
                  <button
                    type="button"
                    onClick={refreshRequests}
                    disabled={refreshingRequests}
                    className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-slate-300 transition hover:text-white"
                  >
                    {refreshingRequests ? "Refreshing..." : "Refresh"}
                  </button>
                </div>
                <AdminAccessRequestsTable
                  requests={requests}
                  selectedNetid={selectedRequest?.netid}
                  onSelect={(request) => setSelectedRequest(request)}
                />
              </div>
            )}
          </div>
          <div>
            {tab === "users" ? (
              <AdminUsersDetail
                user={selectedUser}
                analytics={selectedUserAnalytics}
                loading={userDetailLoading}
                onSaveComplete={(updated) => {
                  setSelectedUser(updated);
                  fetchAdminUserAnalytics(updated.netid)
                    .then((analytics) => setSelectedUserAnalytics(analytics))
                    .catch(() => setError("Failed to refresh user analytics."));
                  refreshUsers();
                  refreshGlobalAnalytics();
                }}
              />
            ) : (
              <AdminAccessRequestDetail
                request={selectedRequest}
                onActionComplete={refreshRequests}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
