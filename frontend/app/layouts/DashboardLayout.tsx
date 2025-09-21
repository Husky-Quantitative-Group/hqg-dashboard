import { Outlet, NavLink } from "react-router-dom";
import Sidebar from "../components/sidebar";

export default function DashboardLayout() {
  return (
    <div className="grid h-screen min-h-0 grid-cols-[16rem_1fr] overflow-hidden">
      <Sidebar/>

      <main className="min-h-0 h-screen overflow-y-auto overscroll-contain p-6">
        {/* global filters / header could go here */}
        <Outlet />
      </main>
    </div>
  );
}
