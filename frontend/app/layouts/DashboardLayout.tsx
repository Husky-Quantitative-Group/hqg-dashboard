import { Outlet, NavLink } from "react-router-dom";
import Sidebar from "../components/sidebar";

export default function DashboardLayout() {
  return (
    <>
      <Sidebar />
      <main
        id="main-content"
        className="min-h-screen overflow-y-auto p-6"
        style={{
          marginLeft: "var(--sidebar-width, 210px)",
          willChange: "margin-left",
          backfaceVisibility: "hidden",
          transform: "translateZ(0)",
          transition: "margin-left 1s cubic-bezier(0.25, 0.1, 0.25, 1)",
        }}
      >
        {/* global filters / header could go here */}
        <Outlet />
      </main>
    </>
  );
}
