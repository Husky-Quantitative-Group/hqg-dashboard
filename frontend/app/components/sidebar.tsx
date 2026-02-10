import { NavLink, useLocation } from "react-router-dom";
import { useState } from "react";
import { useUser } from "~/context/UserConext";

type Item = {
  label: string;
  to?: string; // if omitted => rendered disabled
  icon?: React.ReactNode;
};

function navClasses({ isActive }: { isActive: boolean }) {
  return [
    "group relative flex items-center gap-3 px-3 py-2 rounded-r-md transition",
    "text-slate-300 hover:text-white hover:bg-slate-800/60",
    // add an 'active' class so child indicator can target it
    isActive ? "active bg-slate-800/60 text-white" : "",
  ].join(" ");
}

function DisabledItem({
  label,
  icon,
}: {
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <div
      aria-disabled="true"
      className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-500 cursor-not-allowed"
      title="Not available yet"
    >
      {icon ?? <span className="text-lg">•</span>}
      <span className="text-sm">{label}</span>
    </div>
  );
}

function Section({
  title,
  items,
  defaultOpen = true,
}: {
  title: string;
  items: Item[];
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const location = useLocation();

  // Section is active if current path matches any item within the section
  const sectionActive = items.some((it) => {
    if (!it.to) return false;
    const to = it.to;
    const path = location.pathname;
    if (to === "/") return path === "/"; // handle root precisely
    return path === to || path.startsWith(to + "/");
  });

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={[
          "flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-wide",
          sectionActive ? "text-[#CB3CFF]" : "text-slate-400",
        ].join(" ")}
      >
        <span>{title}</span>
        <span className={`transition ${open ? "rotate-90" : ""}`}>›</span>
      </button>

      {open && (
        <div className="space-y-1">
          {items.map((it) =>
            it.to ? (
              <NavLink key={it.label} to={it.to} className={navClasses}>
                <span className="pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 h-full w-[2px] rounded-full bg-[#CB3CFF] transition-opacity group-[&:not(.active)]:opacity-0" />
                <span className="text-sm">{it.label}</span>
              </NavLink>
            ) : (
              <DisabledItem key={it.label} label={it.label} icon={it.icon} />
            )
          )}
        </div>
      )}
    </div>
  );
}

export default function Sidebar() {
  const { user, hasRole } = useUser();
  const displayName = user?.display_name ?? user?.netid ?? "—";
  const dashboardItems = [
    { label: "Strategies", to: "/strategies" },
    ...(hasRole("FUND") ? [{ label: "Portfolio", to: "/portfolio" }] : []),
    ...(hasRole("ADMIN") ? [{ label: "Admin", to: "/admin" }] : []),
  ];
  return (
    <aside className="sticky top-0 h-screen w-64 shrink-0 bg-[#081028] text-slate-200 border-r border-slate-800 flex flex-col overflow-y-auto overscroll-contain">
      {/* Logo */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-4">
          <img src="/hqg-logo.png" className="w-[42px] h-auto object-contain rounded-xl shadow" />
          <span className="logo-text text-2xl font-black tracking-wide">HQG Dash</span>
        </div>
      </div>

      {/* Search */}
      <div className="px-4">
        <div className="flex items-center gap-2 rounded-xl bg-slate-900 ring-1 ring-slate-800 px-3 py-2">
          <span className="text-slate-500">⌕</span>
          <input
            placeholder="Search..."
            className="w-full bg-transparent text-sm outline-none placeholder:text-slate-500"
          />
        </div>
      </div>

      {/* Sections */}
      <nav className="mt-4 px-2 space-y-4">
        <Section
          title="Dashboard"
          items={dashboardItems}
        />
      </nav>

      {/* Bottom */}
      <div className="mt-auto px-2 pb-4 space-y-2">
        <Section
          title="Settings"
          defaultOpen={false}
          items={[{ label: "Preferences" }]}
        />
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="h-8 w-8 rounded-full bg-gradient-to-br from-fuchsia-500 to-indigo-500" />
          <div className="leading-tight">
            <div className="text-sm">{displayName}</div>
            <div className="text-xs text-slate-400">Account settings</div>
          </div>
          <span className="ml-auto text-xs text-slate-600">›</span>
        </div>
      </div>
    </aside>
  );
}
