import type { Route } from "./+types/apply";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Apply | HQG Dash" },
    { name: "description", content: "Application page" },
  ];
}

export default function Apply() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-white px-6 text-slate-700">
      <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold text-slate-900">Apply</h1>
        <p className="mt-3 text-sm text-slate-600">
          This page is a placeholder. The application flow will live here.
        </p>
      </div>
    </div>
  );
}
