import { coreApi } from "../api/core";

const coreBaseUrl = coreApi.defaults.baseURL ?? "";
const loginUrl = `${coreBaseUrl}/auth/login`;

export default function Login() {
  console.log(loginUrl);
  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060c1d]">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-16 right-8 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />
      <div className="pointer-events-none absolute left-10 top-24 h-56 w-56 rounded-full bg-sky-400/20 blur-3xl" />
      <div className="pointer-events-none absolute right-16 top-1/3 h-64 w-64 rounded-full bg-violet-500/15 blur-3xl" />
      <div className="pointer-events-none absolute bottom-12 left-1/4 h-72 w-72 rounded-full bg-blue-500/15 blur-3xl" />

      <div className="relative flex min-h-screen items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm rounded-3xl bg-white px-8 py-10 text-center shadow-[0_20px_60px_-35px_rgba(15,23,42,0.65)] ring-1 ring-slate-200">
          <div className="mx-auto flex w-full flex-col items-center gap-3">
            <img
              src="/hqg-logo-no-bg.png"
              alt="HQG Dash logo"
              className="h-20 w-20 rounded-2xl object-contain"
            />
            <div>
              <div className="logo-text text-2xl font-black tracking-wide text-slate-900">
                HQG Dash
              </div>
              <p className="mt-1 text-sm text-slate-500">
                Sign in with your UConn NetID
              </p>
            </div>
          </div>

          <a
            href={loginUrl}
            className="mt-8 inline-flex w-full items-center justify-center rounded-xl bg-[#1e4db7] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/20 transition hover:bg-[#1a43a1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1e4db7] focus-visible:ring-offset-2"
          >
            Continue with UConn
          </a>
          <p className="mt-4 text-xs text-slate-500">
            You’ll be redirected to login.uconn.edu to sign in.
          </p>
        </div>
      </div>
    </div>
  );
}
