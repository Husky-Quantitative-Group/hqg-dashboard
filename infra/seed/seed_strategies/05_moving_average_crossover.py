"""
Strategy 5: Moving Average Crossover

Classic Golden Cross / Death Cross strategy using 50-day and 200-day SMAs.
Goes long when fast crosses above slow (bullish), to cash when crosses below (bearish).
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class MovingAverageCrossover(Strategy):
    FAST_PERIOD = 50   # 50-day SMA
    SLOW_PERIOD = 200  # 200-day SMA

    def __init__(self):
        self._is_long = False

    def universe(self) -> list[str]:
        return ["SPY"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            # Calculate current fast SMA
            fast_sum = 0
            for i in range(self.FAST_PERIOD):
                price = data.close("SPY", bars_ago=i)
                if price is None:
                    return None
                fast_sum += price
            fast_sma = fast_sum / self.FAST_PERIOD

            # Calculate current slow SMA
            slow_sum = 0
            for i in range(self.SLOW_PERIOD):
                price = data.close("SPY", bars_ago=i)
                if price is None:
                    return None
                slow_sum += price
            slow_sma = slow_sum / self.SLOW_PERIOD

            # Calculate previous period SMAs for crossover detection
            fast_sum_prev = 0
            for i in range(1, self.FAST_PERIOD + 1):
                price = data.close("SPY", bars_ago=i)
                if price is None:
                    return None
                fast_sum_prev += price
            fast_sma_prev = fast_sum_prev / self.FAST_PERIOD

            slow_sum_prev = 0
            for i in range(1, self.SLOW_PERIOD + 1):
                price = data.close("SPY", bars_ago=i)
                if price is None:
                    return None
                slow_sum_prev += price
            slow_sma_prev = slow_sum_prev / self.SLOW_PERIOD

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
