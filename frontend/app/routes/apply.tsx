import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { coreApi } from "../api/core";
import type { Route } from "./+types/apply";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Apply | HQG Dash" },
    { name: "description", content: "Application page" },
  ];
}

export default function Apply() {
  const [formData, setFormData] = useState({
    full_name: "",
    uconn_email: "",
    discord_username: "",
    linkedin_url: "",
    github_url: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const canSubmit = useMemo(() => {
    return formData.full_name.trim() && formData.uconn_email.trim();
  }, [formData.full_name, formData.uconn_email]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setFieldErrors({});

    try {
      await coreApi.post("/auth/apply", {
        full_name: formData.full_name.trim(),
        uconn_email: formData.uconn_email.trim(),
        discord_username: formData.discord_username.trim(),
        linkedin_url: formData.linkedin_url.trim(),
        github_url: formData.github_url.trim(),
      });
      setSuccess(true);
    } catch (err: any) {
      const response = err?.response;
      const message = response?.data?.message || "Something went wrong. Try again.";
      const errors = response?.data?.errors;
      setError(message);
      if (errors && typeof errors === "object") {
        setFieldErrors(errors);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#060c1d] px-6 py-16 text-slate-100">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-fuchsia-500/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-10 left-10 h-64 w-64 rounded-full bg-sky-400/20 blur-3xl" />
      <div className="pointer-events-none absolute right-10 top-24 h-80 w-80 rounded-full bg-indigo-500/20 blur-3xl" />

      <div className="relative mx-auto w-full max-w-2xl">
        <div className="apply-font rounded-[28px] border border-slate-800/70 bg-slate-950/70 p-10 shadow-[0_30px_80px_-55px_rgba(15,23,42,0.9)] backdrop-blur">
          <div className="flex flex-col gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
              HQG Dashboard Access
            </span>
            <h1 className="text-3xl font-semibold text-white">
              Request access to HQG Dash
            </h1>
            <p className="max-w-xl text-sm text-slate-300">
              Tell us a bit about yourself. We’ll review applications and follow up
              through your UConn email.
            </p>
          </div>

          {success ? (
            <div className="mt-10 rounded-2xl border border-emerald-500/40 bg-emerald-500/10 p-6 text-emerald-100">
              <h2 className="text-lg font-semibold">Application received</h2>
              <p className="mt-2 text-sm text-emerald-100/80">
                Thanks! We’ll review your request and reach out soon.
              </p>
            </div>
          ) : (
            <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
              <div className="grid gap-5 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                  Display Name *
                  <input
                    type="text"
                    value={formData.full_name}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, full_name: event.target.value }))
                    }
                    className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white shadow-sm shadow-black/30 transition focus:border-slate-500 focus:outline-none"
                    placeholder="Jane Doe"
                    required
                  />
                  {fieldErrors.full_name && (
                    <span className="text-xs text-rose-600">{fieldErrors.full_name}</span>
                  )}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                  UConn Email *
                  <input
                    type="email"
                    value={formData.uconn_email}
                    onChange={(event) =>
                      setFormData((prev) => ({ ...prev, uconn_email: event.target.value }))
                    }
                    className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white shadow-sm shadow-black/30 transition focus:border-slate-500 focus:outline-none"
                    placeholder="...@uconn.edu"
                    required
                  />
                  {fieldErrors.uconn_email && (
                    <span className="text-xs text-rose-600">{fieldErrors.uconn_email}</span>
                  )}
                </label>
              </div>

              <div className="grid gap-5 md:grid-cols-2">
                <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                  Discord Username (optional)
                  <input
                    type="text"
                    value={formData.discord_username}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        discord_username: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white shadow-sm shadow-black/30 transition focus:border-slate-500 focus:outline-none"
                  />
                  {fieldErrors.discord_username && (
                    <span className="text-xs text-rose-600">
                      {fieldErrors.discord_username}
                    </span>
                  )}
                </label>

                <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                  LinkedIn Profile URL (optional)
                  <input
                    type="url"
                    value={formData.linkedin_url}
                    onChange={(event) =>
                      setFormData((prev) => ({
                        ...prev,
                        linkedin_url: event.target.value,
                      }))
                    }
                    className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white shadow-sm shadow-black/30 transition focus:border-slate-500 focus:outline-none"
                    placeholder="https://linkedin.com/in/..."
                  />
                  {fieldErrors.linkedin_url && (
                    <span className="text-xs text-rose-600">{fieldErrors.linkedin_url}</span>
                  )}
                </label>
              </div>

              <label className="flex flex-col gap-2 text-sm font-medium text-slate-200">
                GitHub Profile URL (optional)
                <input
                  type="url"
                  value={formData.github_url}
                  onChange={(event) =>
                    setFormData((prev) => ({
                      ...prev,
                      github_url: event.target.value,
                    }))
                  }
                  className="rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white shadow-sm shadow-black/30 transition focus:border-slate-500 focus:outline-none"
                  placeholder="https://github.com/..."
                />
                {fieldErrors.github_url && (
                  <span className="text-xs text-rose-600">{fieldErrors.github_url}</span>
                )}
              </label>

              {error && (
                <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={!canSubmit || submitting}
                className="inline-flex w-full items-center justify-center rounded-xl bg-[#1e4db7] px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-blue-900/40 transition hover:bg-[#1a43a1] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Submitting..." : "Submit application"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
