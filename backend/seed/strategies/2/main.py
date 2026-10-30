"""
Strategy 2: Simple Momentum - SPY vs BND
Period: 2010-01-01 to 2020-12-31
Cadence: Daily
Logic: If SPY 20-day return > 0, hold SPY; else hold BND.
No shorting.
"""
from collections import deque
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

START_DATE = "2010-01-01"
END_DATE = "2020-12-31"


class MomentumSPYBND_Daily(Strategy):
    universe = ["SPY", "BND"]
    cadence = Cadence(bar_size=BarSize.DAILY)

    def __init__(self):
        self._lookback = 20
        self._prices = deque(maxlen=self._lookback + 1)

    def on_data(self, data: Slice, portfolio: PortfolioView) -> Signal:
        price = data.close("SPY")
        if price is None:
            return Hold()

        self._prices.append(price)

        if len(self._prices) < self._lookback + 1:
            return TargetWeights({"BND": 1.0})

        momentum = (self._prices[-1] / self._prices[0]) - 1.0

        if momentum > 0:
            return TargetWeights({"SPY": 1.0})
        return TargetWeights({"BND": 1.0})
