"""
Strategy 3: Simple Momentum

Ranks stocks by past 6-month returns and allocates equally to top 5 performers.
Demonstrates cross-sectional momentum: winners tend to keep winning.
"""
from datetime import timedelta
from collections import deque
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class SimpleMomentum(Strategy):
    MOMENTUM_DAYS = 126  # 6-month lookback
    TOP_N = 5

    def __init__(self):
        # Store historical prices for each symbol
        self.price_history = {}

    def universe(self) -> list[str]:
        return [
            "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA",
            "JPM", "BAC", "WFC", "GS", "MS",
            "JNJ", "UNH", "PFE", "ABBV", "TMO",
            "XOM", "CVX", "COP", "SLB",
            "WMT", "HD", "NKE", "MCD", "COST"
        ]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=30))  # Monthly rebalance

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        momentum_scores = {}

        for symbol in self.universe():
            try:
                current_price = data.close(symbol)
                if current_price is None:
                    continue

                # Initialize price history for this symbol if needed
                if symbol not in self.price_history:
                    self.price_history[symbol] = deque(maxlen=self.MOMENTUM_DAYS + 1)

                # Store current price
                self.price_history[symbol].append(current_price)

                # Need at least MOMENTUM_DAYS of data
                if len(self.price_history[symbol]) < self.MOMENTUM_DAYS + 1:
                    continue

                # Get the oldest price (MOMENTUM_DAYS ago)
                past_price = self.price_history[symbol][0]
                if past_price is None or past_price <= 0:
                    continue

                # Calculate return over lookback period
                momentum = (current_price / past_price) - 1.0
                momentum_scores[symbol] = momentum
            except Exception:
                continue

        if len(momentum_scores) < self.TOP_N:
            return {}  # Not enough data, hold cash

        # Sort by momentum (highest first) and select top N
        sorted_assets = sorted(momentum_scores.items(), key=lambda x: x[1], reverse=True)
        top_assets = [symbol for symbol, _ in sorted_assets[:self.TOP_N]]

        # Equal-weight allocation
        weight_per_asset = 1.0 / self.TOP_N
        return {symbol: weight_per_asset for symbol in top_assets}
