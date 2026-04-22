import { NavLink, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { useUser } from "~/context/UserConext";

type NavItem = {
  label: string;
  to: string;
  icon: string; // Material Symbols icon name
};

// Color palettes for avatars
const avatarColors = [
  "from-blue-500 to-blue-600",
  "from-purple-500 to-purple-600",
  "from-pink-500 to-pink-600",
  "from-red-500 to-red-600",
  "from-yellow-500 to-yellow-600",
  "from-green-500 to-green-600",
  "from-teal-500 to-teal-600",
  "from-cyan-500 to-cyan-600",
  "from-indigo-500 to-indigo-600",
];

// Hash function to consistently map strings to color indices
const getColorIndex = (str: string, colorCount: number): number => {  
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash) % colorCount;
};

const getAvatarColor = (name: string): string => {
  const index = getColorIndex(name, avatarColors.length);
  return avatarColors[index];
};

const getAvatarText = (name: string): string => {
  if (name.length === 0) return "";
  if (name.includes(" ")) {
    const words = name.split(" ").filter(word => word.length > 0);
    if (words.length < 2) return name.charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
  }
  if (name.length === 1) return name.charAt(0).toUpperCase();
  if (name.length === 2) return (name.charAt(0) + name.charAt(1)).toUpperCase();
  return (name.charAt(0) + name.charAt(2)).toUpperCase();
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
    { label: "Home", to: "/", icon: "home" },
    { label: "Strategies", to: "/strategies", icon: "tactic" },
    ...(hasRole("FUND") || hasRole("ADMIN") ? [{ label: "Portfolio", to: "/portfolio", icon: "work" }] : []),
    ...(hasRole("FUND") || hasRole("ADMIN") ? [{ label: "Leaderboard", to: "/leaderboard", icon: "leaderboard" }] : []),
  ];

  const adminItems: NavItem[] = hasRole("ADMIN")
    ? [{ label: "Admin", to: "/admin", icon: "admin_panel_settings" }]
    : [];

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/" || location.pathname === "/home";
    if (to === "/strategies") return location.pathname.startsWith("/strategies") || location.pathname === "/create-strategy";
    return location.pathname === to || location.pathname.startsWith(to + "/");
  };

  return (
    <>
      {/* Sidebar */}
      <aside
        id="sidebar"
        className="fixed left-0 top-0 h-screen z-50 flex flex-col border-r"
        style={{
          width: isCollapsed ? "75px" : "210px",
          backgroundColor: "#14171a",
          borderColor: "rgba(148, 163, 184, 0.08)",
          willChange: "width",
          backfaceVisibility: "hidden",
          transform: "translateZ(0)",
          transition: "width 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
        {/* Toggle Button */}
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="fixed"
          style={{
            top: "28px",
            left: isCollapsed ? "74px" : "190px",
            width: "20px",
            height: "40px",
            background: "#14171a",
            backdropFilter: "blur(8px)",
            borderLeft: isCollapsed ? "1px solid transparent" : "1px solid rgba(148, 163, 184, 0.12)",
            borderRight: isCollapsed ? "1px solid rgba(148, 163, 184, 0.12)" : "1px solid transparent",
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
            transition: "all 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
          }}
          title="Toggle Sidebar"
        >
          <span
            className="material-symbols-outlined"
            style={{
              fontSize: "16px",
              transform: isCollapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
            }}
          >
            chevron_left
          </span>
        </button>

        {/* Logo Section */}
        <div
          className="flex items-center shrink-0 overflow-hidden"
          style={{
            height: "66px",
            paddingLeft: "21px",
            paddingBottom: "55px",
            paddingTop: "48px",
            paddingRight: isCollapsed ? "22px" : "24px",
            gap: "12px",
            transition: "padding-right 0.7s cubic-bezier(0.5, 0.1, 0.25, 1)",
          }}
        >
          <img
            alt="HQG Logo"
            src="/hqg-logo.png"
            className="h-8 w-8 shrink-0 object-contain"
            style={{ flexShrink: 0, minWidth: "35px", minHeight: "35px" }}
          />
          <h1
            className="font-bold tracking-tighter"
            style={{
              fontSize: "1.25rem",
              color: "#eef2f6",
              fontFamily: '"Plus Jakarta Sans", sans-serif',
              opacity: isCollapsed ? 0 : 1,
              transition: "opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
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
                    paddingLeft: "24px",
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
                      transition: "opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
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
                      paddingLeft: "24px",
                      paddingRight: isCollapsed ? "22px" : "24px",
                      paddingTop: "14px",
                      paddingBottom: "14px",
                      gap: "16px",
                    }}
                  >
                    <span
                      className="material-symbols-outlined shrink-0"
                      style={{
                        fontSize: "24px",
                        fontVariationSettings: "'FILL' 0, 'wght' 400, 'GRAD' 0, 'opsz' 24",
                        flexShrink: 0,
                        marginLeft: "-2px",
                      }}
                    >
                      {item.icon}
                    </span>
                    <div
                      style={{
                        opacity: isCollapsed ? 0 : 1,
                        transition: "opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
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
              paddingLeft: "24px",
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
                transition: "opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
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
            className="flex items-center overflow-hidden"
            title={isCollapsed ? displayName : ""}
            style={{
              borderTop: "1px solid rgba(148, 163, 184, 0.08)",
              paddingLeft: "24px",
              paddingRight: isCollapsed ? "22px" : "24px",
              paddingTop: "12px",
              paddingBottom: "12px",
              gap: "16px",
              transition: "padding-right 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
            }}
          >
            <div
              className={`w-6 h-6 rounded-full overflow-hidden border shrink-0 bg-gradient-to-br ${getAvatarColor(displayName)} flex items-center justify-center text-[10px] font-bold text-white`}
              style={{
                border: "1px solid rgba(148, 163, 184, 0.2)",
                flexShrink: 0,
                minWidth: "24px",
                minHeight: "24px",
              }}
            >
              {getAvatarText(displayName)}
            </div>
            <div
              style={{
                width: isCollapsed ? "0" : "auto",
                flex: isCollapsed ? "0 0 0" : "1",
                opacity: isCollapsed ? 0 : 1,
                transition: "opacity 0.7s cubic-bezier(0.25, 0.1, 0.25, 1), width 0.7s cubic-bezier(0.25, 0.1, 0.25, 1)",
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
