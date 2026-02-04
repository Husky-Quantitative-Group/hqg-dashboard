"""
Strategy 7: Equal Risk Contribution (Risk Parity Lite)

Allocates capital so each asset contributes equally to portfolio risk.
Achieved by weighting assets inversely to their volatility: low vol assets get higher weights.
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class EqualRiskContribution(Strategy):
    LOOKBACK_DAYS = 60
    TRADING_DAYS_PER_YEAR = 252

    def universe(self) -> list[str]:
        return ["SPY", "EFA", "TLT", "IEF", "GLD"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(weeks=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            # Calculate realized volatility for each asset
            volatilities = {}

            for symbol in self.universe():
                returns = []
                for i in range(self.LOOKBACK_DAYS - 1):
                    price_today = data.close(symbol, bars_ago=i)
                    price_yesterday = data.close(symbol, bars_ago=i + 1)

                    if price_today is None or price_yesterday is None:
                        continue
                    if price_yesterday <= 0:
                        continue

                    daily_return = (price_today / price_yesterday) - 1.0
                    returns.append(daily_return)

                if len(returns) < self.LOOKBACK_DAYS * 0.7:
                    continue

                # Calculate annualized volatility
                mean_return = sum(returns) / len(returns)
                variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
                daily_vol = variance ** 0.5
                annualized_vol = daily_vol * (self.TRADING_DAYS_PER_YEAR ** 0.5)
                volatilities[symbol] = max(annualized_vol, 1e-6)

            if len(volatilities) < 3:
                return None

            # Weight by inverse volatility
            inverse_vols = {symbol: 1.0 / vol for symbol, vol in volatilities.items()}

            # Normalize weights to sum to 1.0
            total_inverse_vol = sum(inverse_vols.values())
            weights = {symbol: inv_vol / total_inverse_vol for symbol, inv_vol in inverse_vols.items()}

            return weights
        except Exception:
            return None
