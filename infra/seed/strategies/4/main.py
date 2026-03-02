"""
Strategy 06: Mean Reversion (RSI-like) – AAPL vs BND
Period: 2010-01-01 to 2025-06-30
Cadence: Daily
Logic: Compute 14-day RSI on AAPL.
       RSI < 30 → oversold → AAPL 80% / BND 20%
       RSI > 70 → overbought → BND 100%
       Otherwise → AAPL 50% / BND 50%
No shorting.
"""
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView, BarSize
from collections import deque

START_DATE = "2010-01-01"
END_DATE = "2025-06-30"


class MeanReversionRSI_Daily(Strategy):
    def __init__(self):
        self._period = 14
        self._prices = deque(maxlen=self._period + 1)
        self._first_trade = True

    def universe(self) -> list[str]:
        return ["AAPL", "BND"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=BarSize.DAILY)

    def _compute_rsi(self) -> float | None:
        if len(self._prices) < self._period + 1:
            return None

        prices = list(self._prices)
        gains = []
        losses = []
        for i in range(1, len(prices)):
            change = prices[i] - prices[i - 1]
            if change > 0:
                gains.append(change)
                losses.append(0.0)
            else:
                gains.append(0.0)
                losses.append(abs(change))

        avg_gain = sum(gains) / self._period
        avg_loss = sum(losses) / self._period

        if avg_loss == 0:
            return 100.0

        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        price = data.close("AAPL")
        if price is None:
            return None

        self._prices.append(price)
        rsi = self._compute_rsi()

        if rsi is None:
            if self._first_trade:
                self._first_trade = False
                return {"BND": 1.0}
            return None

        self._first_trade = False

        if rsi < 30:
            return {"AAPL": 0.8, "BND": 0.2}
        elif rsi > 70:
            return {"BND": 1.0}
        else:
            return {"AAPL": 0.5, "BND": 0.5}