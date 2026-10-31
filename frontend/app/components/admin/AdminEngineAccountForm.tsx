import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { Link } from "react-router";
import {
  provisionEngineAccount,
  type ProvisionEngineAccountInput,
} from "~/api/admin";

const fields = [
  {
    key: "account_id",
    label: "Account UUID",
    hint: "Use the account UUID in your configured readiness URL.",
  },
  {
    key: "engine_id",
    label: "Engine UUID",
    hint: "Use the HQG_ENGINE_ID configured on the engine host.",
  },
  {
    key: "netid",
    label: "Controlling NetID",
    hint: "This NetID will be allowed to control the account.",
  },
] as const;

export default function AdminEngineAccountForm() {
  const [form, setForm] = useState<ProvisionEngineAccountInput>({
    account_id: "",
    engine_id: "",
    netid: "",
    allow_live: false,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<ProvisionEngineAccountInput | null>(
    null,
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    setCreated(null);
    try {
      setCreated(
        await provisionEngineAccount({
          ...form,
          account_id: form.account_id.trim(),
          engine_id: form.engine_id.trim(),
          netid: form.netid.trim(),
        }),
      );
    } catch (err) {
      setError(
        isAxiosError(err) && typeof err.response?.data?.message === "string"
          ? err.response.data.message
          : "Failed to provision account.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/40 p-6"
    >
      <h2 className="text-lg font-semibold text-slate-100">
        Provision engine account
      </h2>
      <p className="mt-2 text-sm text-slate-400">
        Create the configured account using the existing service secret. Both
        modes start paused. Existing accounts cannot be overwritten.
      </p>
      <fieldset
        disabled={submitting}
        className="mt-6 space-y-5 disabled:opacity-60"
      >
        {fields.map(({ key, label, hint }) => (
          <div key={key}>
            <label
              htmlFor={`engine-${key}`}
              className="block text-sm font-medium text-slate-200"
            >
              {label}
            </label>
            <input
              id={`engine-${key}`}
              name={key}
              type="text"
              required
              pattern={
                key === "netid"
                  ? undefined
                  : "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              }
              value={form[key]}
              onChange={(event) =>
                setForm({ ...form, [key]: event.target.value })
              }
              aria-describedby={`engine-${key}-hint`}
              className="mt-2 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm text-slate-200"
            />
            <p
              id={`engine-${key}-hint`}
              className="mt-1 text-xs text-slate-400"
            >
              {hint}
            </p>
          </div>
        ))}
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={form.allow_live}
            onChange={(event) =>
              setForm({ ...form, allow_live: event.target.checked })
            }
          />
          Also grant live control permission
        </label>
        <button
          type="submit"
          className="rounded-lg bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-white disabled:cursor-not-allowed"
          disabled={submitting}
        >
          {submitting ? "Provisioning..." : "Provision account"}
        </button>
      </fieldset>
      {error && (
        <p role="alert" className="mt-4 text-sm text-rose-300">
          {error}
        </p>
      )}
      {created && (
        <div role="status" className="mt-4 space-y-2 text-sm text-emerald-300">
          <p>
            Account {created.account_id} provisioned for {created.netid}. Both
            modes are paused.
          </p>
          <Link to="/engine" className="underline">
            Open Engine to register and configure a strategy.
          </Link>
        </div>
      )}
    </form>
  );
}
