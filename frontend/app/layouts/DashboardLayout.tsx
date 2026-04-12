import { Outlet, NavLink } from "react-router-dom";
import Sidebar from "../components/sidebar";

export default function DashboardLayout() {
  return (
    <>
      <Sidebar />
      <main
        id="main-content"
        className="min-h-screen overflow-y-auto overscroll-contain p-6"
        style={{
          marginLeft: "var(--sidebar-width, 210px)",
          willChange: "margin-left",
          backfaceVisibility: "hidden",
          transform: "translateZ(0)",
          transition: "margin-left 0.8s ease",
        }}
      >
        {/* global filters / header could go here */}
        <Outlet />
      </main>
    </>
  );
}
