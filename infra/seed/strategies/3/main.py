"""
Strategy 02: SMA Crossover – QQQ vs AGG
Period: 2005-01-01 to 2015-12-31
Cadence: Weekly
Logic: 10-week SMA vs 30-week SMA on QQQ. If fast > slow, hold QQQ; else hold AGG.
No shorting.
"""
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView, BarSize
from collections import deque

START_DATE = "2005-01-01"
END_DATE = "2015-12-31"


class SMACrossoverQQQ_Weekly(Strategy):
    def __init__(self):
        self._fast_len = 10
        self._slow_len = 30
        self._prices = deque(maxlen=self._slow_len)

    def universe(self) -> list[str]:
        return ["QQQ", "AGG"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=BarSize.WEEKLY)

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        price = data.close("QQQ")
        if price is None:
            return None

        self._prices.append(price)

        if len(self._prices) < self._slow_len:
            return {"AGG": 1.0}

        prices_list = list(self._prices)
        fast_sma = sum(prices_list[-self._fast_len:]) / self._fast_len
        slow_sma = sum(prices_list) / self._slow_len

        if fast_sma > slow_sma:
            return {"QQQ": 1.0}
        else:
            return {"AGG": 1.0}