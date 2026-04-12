import { NavLink, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useUser } from "~/context/UserConext";

type NavItem = {
  label: string;
  to: string;
  icon: string; // Material Symbols icon name
};

export default function Sidebar() {
  const { user, hasRole } = useUser();
  const displayName = user?.display_name ?? user?.netid ?? "—";
  const userRole = user?.roles?.[0] ?? "User";
  const [isCollapsed, setIsCollapsed] = useState(false);
  const location = useLocation();

  // Update main-content margin when sidebar collapse state changes
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sidebar-width', isCollapsed ? '68px' : '210px');
  }, [isCollapsed]);

  // Navigation items
  const navItems: NavItem[] = [
    { label: "Home", to: "/home", icon: "home" },
    { label: "Strategies", to: "/", icon: "tactic" },
    ...(hasRole("FUND") || hasRole("ADMIN") ? [{ label: "Portfolio", to: "/portfolio", icon: "work" }] : []),
    ...(hasRole("FUND") || hasRole("ADMIN") ? [{ label: "Leaderboard", to: "/leaderboard", icon: "leaderboard" }] : []),
  ];

  const adminItems: NavItem[] = hasRole("ADMIN")
    ? [{ label: "Admin", to: "/admin", icon: "admin_panel_settings" }]
    : [];

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/" || (location.pathname.includes("/strategy") && location.pathname !== "/home");
    return location.pathname === to || location.pathname.startsWith(to + "/");
  };

  return (
    <>
      {/* Sidebar */}
      <aside
        id="sidebar"
        className="fixed left-0 top-0 h-screen z-50 flex flex-col border-r"
        style={{
          width: isCollapsed ? "68px" : "210px",
          backgroundColor: "#0a0e17",
          borderColor: "rgba(148, 163, 184, 0.08)",
          willChange: "width",
          backfaceVisibility: "hidden",
          transform: "translateZ(0)",
          transition: "width 0.8s ease",
        }}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="fixed"
          style={{
            top: "38px",
            left: isCollapsed ? "67px" : "190px",
            width: "20px",
            height: "40px",
            background: "rgba(10, 14, 23, 0.85)",
            backdropFilter: "blur(8px)",
            borderLeft: isCollapsed ? "1px solid transparent" : "1px solid rgba(148, 163, 184, 0.15)",
            borderRight: isCollapsed ? "1px solid rgba(148, 163, 184, 0.15)" : "1px solid transparent",
            borderTop: "1px solid rgba(148, 163, 184, 0.15)",
            borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
            borderRadius: isCollapsed ? "0 6px 6px 0" : "6px 0 0 6px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            zIndex: 500,
            color: "#e2e9f0",
            boxShadow: "4px 0 12px rgba(0,0,0,0.4)",
            transition: "all 0.8s ease",
          }}
          title="Toggle Sidebar"
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: "16px",
              transform: isCollapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.5s ease",
            }}
          >
            chevron_left
          </span>
        </button>

        {/* Logo Section */}
        <div
          className="flex items-center shrink-0 overflow-hidden transition-all duration-500"
          style={{
            height: "126px",
            paddingBottom: "24px",
            paddingLeft: isCollapsed ? "22px" : "24px",
            paddingRight: isCollapsed ? "22px" : "24px",
            gap: "12px",
          }}
        >
          <img
            alt="HQG Logo"
            src="/hqg-logo.png"
            className="w-6 h-6 object-contain shrink-0"
            style={{ flexShrink: 0, minWidth: "24px", minHeight: "24px" }}
          />
          <h1
            className="font-bold tracking-tighter"
            style={{
              fontSize: "1.25rem",
              color: "#eef2f6",
              fontFamily: "Manrope, sans-serif",
              opacity: isCollapsed ? 0 : 1,
              transition: "opacity 0.5s ease, width 0.5s ease",
              whiteSpace: "nowrap",
              width: isCollapsed ? "0" : "auto",
              overflow: "hidden",
              willChange: "width, opacity",
            }}
          >
            HQG Dash
          </h1>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto" style={{ fontSize: "0.75rem", marginTop: "-20px" }}>
          <div>
            {navItems.map((item) => {
              const active = isActive(item.to);
              return (
                <NavLink
                  key={item.label}
                  to={item.to}
                  title={isCollapsed ? item.label : ""}
                  className="sidebar-link flex items-center transition-colors w-full overflow-hidden"
                  style={{
                    color: active ? "#c7d2fe" : "#9caec2",
                    backgroundColor: active ? "rgba(129, 140, 248, 0.25)" : "transparent",
                    borderLeft: active ? "2px solid #818cf8" : "2px solid transparent",
                    paddingLeft: isCollapsed ? "22px" : "24px",
                    paddingRight: isCollapsed ? "22px" : "24px",
                    paddingTop: "14px",
                    paddingBottom: "14px",
                    gap: "16px",
                  }}
                >
                  <span
                    className="material-symbols-outlined shrink-0"
                    style={{
                      fontSize: "25px",
                      fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                      flexShrink: 0,
                    }}
                  >
                    {item.icon}
                  </span>
                  <div
                    style={{
                      opacity: isCollapsed ? 0 : 1,
                      transition: "opacity 0.5s ease, width 0.5s ease",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      width: isCollapsed ? "0" : "auto",
                      flex: isCollapsed ? "0 0 0" : "1",
                      willChange: "width, opacity",
                    }}
                  >
                    <span
                      className="font-medium uppercase tracking-wider"
                      style={{
                        fontSize: "10px",
                        fontFamily: "Inter, sans-serif",
                      }}
                    >
                      {item.label}
                    </span>
                  </div>
                </NavLink>
              );
            })}
          </div>
        </nav>

        {/* Bottom - Admin, Settings & User Profile */}
        <div style={{ paddingBottom: "25px", paddingLeft: "0", paddingRight: "0" }}>
          {/* Admin Section - if applicable */}
          {adminItems.length > 0 && (
            <div style={{ paddingLeft: "0" }}>
              {adminItems.map((item) => {
                const active = isActive(item.to);
                return (
                  <NavLink
                    key={item.label}
                    to={item.to}
                    title={isCollapsed ? item.label : ""}
                    className="sidebar-link flex items-center transition-colors w-full overflow-hidden"
                    style={{
                      color: active ? "#c7d2fe" : "#9caec2",
                      backgroundColor: active ? "rgba(129, 140, 248, 0.25)" : "transparent",
                      borderLeft: active ? "2px solid #818cf8" : "2px solid transparent",
                      paddingLeft: isCollapsed ? "22px" : "24px",
                      paddingRight: isCollapsed ? "22px" : "24px",
                      paddingTop: "12px",
                      paddingBottom: "12px",
                      gap: "16px",
                    }}
                  >
                    <span
                      className="material-symbols-outlined shrink-0"
                      style={{
                        fontSize: "24px",
                        fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                        flexShrink: 0,
                        marginLeft: "-1px",
                      }}
                    >
                      {item.icon}
                    </span>
                    <div
                      style={{
                        opacity: isCollapsed ? 0 : 1,
                        transition: "opacity 0.5s ease, width 0.5s ease",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        width: isCollapsed ? "0" : "auto",
                        flex: isCollapsed ? "0 0 0" : "1",
                        willChange: "width, opacity",
                      }}
                    >
                      <span
                        className="font-medium uppercase tracking-wider"
                        style={{
                          fontSize: "10px",
                          fontFamily: "Inter, sans-serif",
                        }}
                      >
                        {item.label}
                      </span>
                    </div>
                  </NavLink>
                );
              })}
            </div>
          )}

          {/* Settings Link */}
          <NavLink
            to="/settings"
            title={isCollapsed ? "Settings" : ""}
            className="sidebar-link flex items-center transition-colors w-full overflow-hidden"
            style={{
              color: "#9caec2",
              paddingLeft: isCollapsed ? "22px" : "24px",
              paddingRight: isCollapsed ? "22px" : "24px",
              paddingTop: "12px",
              paddingBottom: "12px",
              gap: "16px",
            }}
          >
            <span
              className="material-symbols-outlined shrink-0"
              style={{
                fontSize: "24px",
                fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                flexShrink: 0,
              }}
            >
              settings
            </span>
            <div
              style={{
                opacity: isCollapsed ? 0 : 1,
                transition: "opacity 0.4s ease, width 0.5s ease",
                whiteSpace: "nowrap",
                overflow: "hidden",
                width: isCollapsed ? "0" : "auto",
                flex: isCollapsed ? "0 0 0" : "1",
              }}
            >
              <span
                className="font-medium uppercase tracking-wider"
                style={{
                  fontSize: "10px",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                Settings
              </span>
            </div>
          </NavLink>

          {/* User Profile Section */}
          <div
            className="flex items-center transition-all duration-500 overflow-hidden"
            title={isCollapsed ? displayName : ""}
            style={{
              borderTop: "1px solid rgba(148, 163, 184, 0.08)",
              paddingLeft: isCollapsed ? "22px" : "24px",
              paddingRight: isCollapsed ? "22px" : "24px",
              paddingTop: "12px",
              paddingBottom: "12px",
              gap: "16px",
            }}
          >
            <div
              className="w-6 h-6 rounded-full overflow-hidden border shrink-0"
              style={{
                border: "1px solid rgba(148, 163, 184, 0.2)",
                flexShrink: 0,
                minWidth: "24px",
                minHeight: "24px",
              }}
            >
              <img
                alt={displayName}
                src={`https://ui-avatars.com/api/?name=${displayName}&background=8b5cf6&color=fff`}
                className="w-full h-full object-cover"
              />
            </div>
            <div
              style={{
                width: isCollapsed ? "0" : "auto",
                flex: isCollapsed ? "0 0 0" : "1",
                opacity: isCollapsed ? 0 : 1,
                transition: "opacity 0.5s ease, width 0.5s ease",
                overflow: "hidden",
                whiteSpace: "nowrap",
                willChange: "width, opacity",
              }}
            >
              <span
                className="text-xs font-bold block truncate"
                style={{
                  color: "#eef2f6",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                {displayName}
              </span>
              <span
                className="text-[10px] uppercase tracking-tighter block"
                style={{
                  color: "#9caec2",
                  fontFamily: "Inter, sans-serif",
                }}
              >
                {userRole}
              </span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main content adjustment - handled by flex in DashboardLayout */}
    </>
  );
}
