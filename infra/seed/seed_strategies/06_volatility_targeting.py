"""
Strategy 6: Volatility Targeting

Dynamically adjusts position size to maintain constant portfolio volatility.
When realized vol is high, reduce exposure. When vol is low, increase exposure.
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class VolatilityTargeting(Strategy):
    TARGET_VOL = 0.10  # Target 10% annualized volatility
    LOOKBACK_DAYS = 60
    TRADING_DAYS_PER_YEAR = 252

    def universe(self) -> list[str]:
        return ["SPY"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(weeks=1))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            # Calculate daily returns over lookback period
            returns = []
            for i in range(self.LOOKBACK_DAYS - 1):
                price_today = data.close("SPY", bars_ago=i)
                price_yesterday = data.close("SPY", bars_ago=i + 1)

                if price_today is None or price_yesterday is None:
                    continue
                if price_yesterday <= 0:
                    continue

                daily_return = (price_today / price_yesterday) - 1.0
                returns.append(daily_return)

            if len(returns) < self.LOOKBACK_DAYS * 0.8:
                return None

            # Calculate realized volatility (standard deviation of returns)
            mean_return = sum(returns) / len(returns)
            variance = sum((r - mean_return) ** 2 for r in returns) / len(returns)
            daily_vol = variance ** 0.5

            # Annualize volatility
            annualized_vol = daily_vol * (self.TRADING_DAYS_PER_YEAR ** 0.5)

            if annualized_vol < 1e-6:
                return {"SPY": 0.0}

            # Position size = Target Vol / Realized Vol
            # If realized vol = 20%, position = 10% / 20% = 0.5 (50% exposure)
            # If realized vol = 5%, position = 10% / 5% = 2.0 (200% via leverage)
            position_size = self.TARGET_VOL / annualized_vol
            position_size = max(0.0, min(position_size, 2.0))  # Cap at 2x leverage

            return {"SPY": position_size}
        except Exception:
            return None
