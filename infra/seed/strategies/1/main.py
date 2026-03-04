"""
Strategy 1: Buy and Hold SPY

Simplest passive investing strategy - buy SPY once and hold forever.
Serves as a baseline for comparing other strategies.
"""
from hqg_algorithms import (
    Strategy,
    Cadence,
    Slice,
    PortfolioView,
    BarSize,
    Signal,
    TargetWeights,
    Hold,
)


class BuyAndHoldSpy(Strategy):
    universe = ["SPY"]
    cadence = Cadence(bar_size=BarSize.WEEKLY)

    def __init__(self):
        self._initialized = False

    def on_data(self, data: Slice, portfolio: PortfolioView) -> Signal:
        if not self._initialized:
            self._initialized = True
            return TargetWeights({"SPY": 1.0})
        return Hold()
