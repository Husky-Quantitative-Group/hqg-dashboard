import { useUser } from "~/context/UserConext";

export default function Portfolio() {
  const { hasRole } = useUser();
  if (!hasRole("FUND")) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6 text-slate-200">
        You do not have access to the portfolio.
      </div>
    );
  }
  return <h1>Portfolio</h1>;
}
