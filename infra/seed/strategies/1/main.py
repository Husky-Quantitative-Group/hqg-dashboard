"""
Strategy 1: Buy and Hold SPY

Simplest passive investing strategy - buy SPY once and hold forever.
Serves as a baseline for comparing other strategies.
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class BuyAndHoldSpy(Strategy):
    def __init__(self):
        self._initialized = False

    def universe(self) -> list[str]:
        return ["SPY"]

    def cadence(self) -> Cadence: # Cadence defines 
        return Cadence(bar_size=timedelta(weeks=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        if not self._initialized:
            self._initialized = True
            return {"SPY": 1.0}  # 100% allocation to SPY
        return None  # Hold - no changes
