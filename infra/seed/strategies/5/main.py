"""
Strategy 5: Moving Average Crossover

Classic Golden Cross / Death Cross strategy using 50-day and 200-day SMAs.
Goes long when fast crosses above slow (bullish), to cash when crosses below (bearish).
"""
from datetime import timedelta
from collections import deque
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class MovingAverageCrossover(Strategy):
    FAST_PERIOD = 50   # 50-day SMA
    SLOW_PERIOD = 200  # 200-day SMA

    def __init__(self):
        self._is_long = False
        self.prices = deque(maxlen=self.SLOW_PERIOD + 1)

    def universe(self) -> list[str]:
        return ["SPY"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            price = data.close("SPY")
            if price is None:
                return None

            self.prices.append(price)
g
            # Need at least SLOW_PERIOD + 1 for current and previous SMAs
            if len(self.prices) < self.SLOW_PERIOD + 1:
                return None

            # Calculate current fast SMA (using most recent FAST_PERIOD prices)
            fast_sma = sum(list(self.prices)[-self.FAST_PERIOD:]) / self.FAST_PERIOD

            # Calculate current slow SMA (using most recent SLOW_PERIOD prices)
            slow_sma = sum(list(self.prices)[-self.SLOW_PERIOD:]) / self.SLOW_PERIOD

            # Calculate previous period SMAs (excluding the most recent price)
            prices_list = list(self.prices)
            fast_sma_prev = sum(prices_list[-(self.FAST_PERIOD + 1):-1]) / self.FAST_PERIOD
            slow_sma_prev = sum(prices_list[-(self.SLOW_PERIOD + 1):-1]) / self.SLOW_PERIOD

            # Detect crossover
            if fast_sma > slow_sma and fast_sma_prev <= slow_sma_prev:
                # Golden Cross: go long
                if not self._is_long:
                    self._is_long = True
                    return {"SPY": 1.0}
            elif fast_sma < slow_sma and fast_sma_prev >= slow_sma_prev:
                # Death Cross: go to cash
                if self._is_long:
                    self._is_long = False
                    return {}

            return None
        except Exception:
            return None
