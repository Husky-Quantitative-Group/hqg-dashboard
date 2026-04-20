import StrategyBrowser from "../components/StrategyBrowser";

export default function Home() {
  return (
    <StrategyBrowser
      title="My Strategies"
      description="Browse and manage your strategies."
      scope="mine"
      showCreateButton
    />
  );
}
