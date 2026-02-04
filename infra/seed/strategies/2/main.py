"""
Strategy 2: 60/40 Portfolio

Classic balanced portfolio: 60% stocks (SPY) and 40% bonds (IEF).
Rebalances daily to maintain target allocation.
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class SixtyFortyPortfolio(Strategy):
    def universe(self) -> list[str]:
        return ["SPY", "IEF"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        # Backtester automatically rebalances to match these target weights
        return {"SPY": 0.6, "IEF": 0.4}
