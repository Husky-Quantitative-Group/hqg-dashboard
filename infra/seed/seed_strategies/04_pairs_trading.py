"""
Strategy 4: Pairs Trading

Trades mean reversion between two correlated stocks (KO and PEP).
When the price spread deviates significantly from its mean, bet on convergence.
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView
import math


class PairsTrading(Strategy):
    LOOKBACK_DAYS = 60
    ENTRY_THRESHOLD = 2.0  # Enter when z-score > 2
    EXIT_THRESHOLD = 0.5   # Exit when z-score < 0.5
    POSITION_SIZE = 0.5    # 50% in each leg

    def __init__(self):
        self._in_position = False
        self._position_direction = 0

    def universe(self) -> list[str]:
        return ["KO", "PEP"]  # Coca-Cola and PepsiCo

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            # Calculate log price spread over lookback period
            spreads = []
            for i in range(self.LOOKBACK_DAYS):
                ko_price = data.close("KO", bars_ago=i)
                pep_price = data.close("PEP", bars_ago=i)

                if ko_price is None or pep_price is None:
                    continue
                if ko_price <= 0 or pep_price <= 0:
                    continue

                # Log spread reduces heteroskedasticity
                spread = math.log(ko_price) - math.log(pep_price)
                spreads.append(spread)

            if len(spreads) < self.LOOKBACK_DAYS * 0.8:
                return None

            # Calculate z-score: (current_spread - mean) / std_dev
            mean_spread = sum(spreads) / len(spreads)
            variance = sum((s - mean_spread) ** 2 for s in spreads) / len(spreads)
            std_spread = variance ** 0.5

            if std_spread < 1e-6:
                return {}

            current_spread = spreads[0]
            z_score = (current_spread - mean_spread) / std_spread

            # Trading logic
            if not self._in_position:
                if z_score > self.ENTRY_THRESHOLD:
                    # Spread too high: short KO, long PEP
                    self._in_position = True
                    self._position_direction = -1
                    return {"KO": -self.POSITION_SIZE, "PEP": self.POSITION_SIZE}
                elif z_score < -self.ENTRY_THRESHOLD:
                    # Spread too low: long KO, short PEP
                    self._in_position = True
                    self._position_direction = 1
                    return {"KO": self.POSITION_SIZE, "PEP": -self.POSITION_SIZE}
            else:
                if abs(z_score) < self.EXIT_THRESHOLD:
                    # Spread has reverted, close position
                    self._in_position = False
                    self._position_direction = 0
                    return {}

            return None
        except Exception:
            return None
