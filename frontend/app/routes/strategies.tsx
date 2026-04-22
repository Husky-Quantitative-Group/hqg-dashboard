import StrategyBrowser from "../components/StrategyBrowser";

export default function Strategies() {
  return (
    <StrategyBrowser
      title="Strategies"
      description="Browse, search, and manage strategies."
      scope="all"
      showCreateButton
    />
  );
}
