import { useEffect, useState } from "react";
import {
  fetchAdminAccessRequests,
  fetchAdminAnalyticsTimeseries,
  fetchAdminUser,
  fetchAdminUserAnalytics,
  fetchAdminUsers,
  type AccessRequest,
  type AdminAnalyticsTimeseries,
  type AdminUser,
  type AdminUserAnalytics,
} from "~/api/admin";
import AdminAccessRequestDetail from "~/components/admin/AdminAccessRequestDetail";
import AdminAccessRequestsTable from "~/components/admin/AdminAccessRequestsTable";
import AdminAnalyticsPanel from "~/components/admin/AdminAnalyticsPanel";
import AdminUsersDetail from "~/components/admin/AdminUsersDetail";
import AdminUsersTable from "~/components/admin/AdminUsersTable";
import { useUser } from "~/context/UserConext";

const TOP_TABS = [
  { id: "overview", label: "Overview" },
  { id: "analytics", label: "Analytics" },
] as const;

const OVERVIEW_TABS = [
  { id: "users", label: "Users" },
  { id: "access", label: "Access Requests" },
] as const;

type TopTabId = (typeof TOP_TABS)[number]["id"];
type OverviewTabId = (typeof OVERVIEW_TABS)[number]["id"];

export default function AdminPage() {
  const { hasRole } = useUser();
  const isAdmin = hasRole("ADMIN");
  const [topTab, setTopTab] = useState<TopTabId>("overview");
  const [overviewTab, setOverviewTab] = useState<OverviewTabId>("users");
  const [analyticsDays, setAnalyticsDays] = useState(30);
  const [analyticsData, setAnalyticsData] = useState<AdminAnalyticsTimeseries | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
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
        const [usersData, requestsData, analytics] = await Promise.all([
          fetchAdminUsers(),
          fetchAdminAccessRequests(),
          fetchAdminAnalyticsTimeseries(analyticsDays),
        ]);
        if (cancelled) return;
        setUsers(usersData);
        setRequests(requestsData);
        setAnalyticsData(analytics);
      } catch (_err) {
        if (!cancelled) setError("Failed to load admin data.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [isAdmin]);

  useEffect(() => {
    if (!isAdmin || loading) return;
    refreshAnalytics(analyticsDays);
  }, [analyticsDays]);

  const refreshUsers = async () => {
    if (!isAdmin || refreshingUsers) return;
    setRefreshingUsers(true);
    try {
      const data = await fetchAdminUsers();
      setUsers(data);
      if (selectedUser) {
        const match = data.find((item) => item.netid === selectedUser.netid);
        setSelectedUser(match ?? null);
        if (!match) setSelectedUserAnalytics(null);
      }
    } catch (_err) {
      setError("Failed to refresh users.");
    } finally {
      setRefreshingUsers(false);
    }
  };

  const refreshRequests = async () => {
    if (!isAdmin || refreshingRequests) return;
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
    } catch (_err) {
      setError("Failed to refresh access requests.");
    } finally {
      setRefreshingRequests(false);
    }
  };

  const refreshAnalytics = async (days = analyticsDays) => {
    if (!isAdmin) return;
    setAnalyticsLoading(true);
    try {
      const data = await fetchAdminAnalyticsTimeseries(days);
      setAnalyticsData(data);
    } catch (_err) {
      setError("Failed to refresh analytics.");
    } finally {
      setAnalyticsLoading(false);
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
    } catch (_err) {
      setError("Failed to load user details.");
    } finally {
      setUserDetailLoading(false);
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
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-100">Admin</h1>
          <p className="text-sm text-slate-400">
            User operations, access requests, and platform telemetry.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-1">
          {TOP_TABS.map((tabOption) => (
            <button
              key={tabOption.id}
              type="button"
              onClick={() => setTopTab(tabOption.id)}
              className={
                "rounded-lg px-4 py-2 text-sm font-medium transition " +
                (topTab === tabOption.id
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

      {!loading && !error && topTab === "analytics" && (
        <AdminAnalyticsPanel
          data={analyticsData}
          loading={analyticsLoading}
          days={analyticsDays}
          onDaysChange={setAnalyticsDays}
        />
      )}

      {!loading && !error && topTab === "overview" && (
        <>
          <div className="flex justify-end">
            <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/50 p-1">
              {OVERVIEW_TABS.map((tabOption) => (
                <button
                  key={tabOption.id}
                  type="button"
                  onClick={() => setOverviewTab(tabOption.id)}
                  className={
                    "rounded-lg px-4 py-2 text-sm font-medium transition " +
                    (overviewTab === tabOption.id
                      ? "bg-slate-800 text-white"
                      : "text-slate-400 hover:text-white")
                  }
                >
                  {tabOption.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_1fr]">
            <div>
              {overviewTab === "users" ? (
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
                    <div className="text-sm font-semibold text-slate-200">Access requests</div>
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
              {overviewTab === "users" ? (
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
                  }}
                />
              ) : (
                <AdminAccessRequestDetail
                  request={selectedRequest}
                  onActionComplete={() => {
                    refreshRequests();
                    refreshUsers();
                    refreshAnalytics();
                  }}
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
