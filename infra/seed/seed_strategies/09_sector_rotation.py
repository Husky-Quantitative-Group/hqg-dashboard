"""
Strategy 9: Sector Rotation

Rotates between sector ETFs based on multi-timeframe momentum.
Identifies which economic sectors are outperforming and allocates to the top 3.
"""
from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class SectorRotation(Strategy):
    SHORT_MOMENTUM_DAYS = 21   # 1 month
    MEDIUM_MOMENTUM_DAYS = 63  # 3 months
    LONG_MOMENTUM_DAYS = 126   # 6 months
    SHORT_WEIGHT = 0.3
    MEDIUM_WEIGHT = 0.4
    LONG_WEIGHT = 0.3
    TOP_N_SECTORS = 3

    def universe(self) -> list[str]:
        return [
            "XLK",   # Technology
            "XLV",   # Healthcare
            "XLF",   # Financials
            "XLY",   # Consumer Discretionary
            "XLC",   # Communication Services
            "XLI",   # Industrials
            "XLP",   # Consumer Staples
            "XLE",   # Energy
            "XLU",   # Utilities
            "XLRE",  # Real Estate
            "XLB",   # Materials
        ]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=21))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            momentum_scores = {}

            for sector in self.universe():
                current_price = data.close(sector)
                if current_price is None or current_price <= 0:
                    continue

                # Calculate returns over 3 different timeframes
                short_past = data.close(sector, bars_ago=self.SHORT_MOMENTUM_DAYS)
                medium_past = data.close(sector, bars_ago=self.MEDIUM_MOMENTUM_DAYS)
                long_past = data.close(sector, bars_ago=self.LONG_MOMENTUM_DAYS)

                if not all([short_past, medium_past, long_past]):
                    continue
                if any(p <= 0 for p in [short_past, medium_past, long_past]):
                    continue

                short_momentum = (current_price / short_past) - 1.0
                medium_momentum = (current_price / medium_past) - 1.0
                long_momentum = (current_price / long_past) - 1.0

                # Combine into composite momentum score
                # This balances recent strength with sustained trends
                composite_momentum = (
                    self.SHORT_WEIGHT * short_momentum +
                    self.MEDIUM_WEIGHT * medium_momentum +
                    self.LONG_WEIGHT * long_momentum
                )

                momentum_scores[sector] = composite_momentum

            if len(momentum_scores) < self.TOP_N_SECTORS:
                return {}

            # Select top N sectors by composite momentum
            sorted_sectors = sorted(
                momentum_scores.items(),
                key=lambda x: x[1],
                reverse=True
            )
            top_sectors = [sector for sector, _ in sorted_sectors[:self.TOP_N_SECTORS]]

            # Equal-weight allocation
            weight = 1.0 / self.TOP_N_SECTORS
            return {sector: weight for sector in top_sectors}

        except Exception:
            return None
