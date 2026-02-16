"""
Strategy 8: Multi-Factor Ranking

Combines momentum, value (P/E ratio), and quality (ROE) factors to rank stocks.
Each factor is z-scored and combined into a composite score. Select top 10 stocks.
"""
from datetime import timedelta
from collections import deque
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class MultiFactorRanking(Strategy):
    MOMENTUM_DAYS = 126
    QUALITY_DAYS = 60
    MOMENTUM_WEIGHT = 0.4
    VALUE_WEIGHT = 0.3
    QUALITY_WEIGHT = 0.3
    TOP_N = 10

    def __init__(self):
        # Store price history for each symbol
        self.price_history = {}

    def universe(self) -> list[str]:
        return [
            "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK.B",
            "UNH", "JNJ", "V", "WMT", "XOM", "JPM", "PG", "MA", "HD", "CVX",
            "ABBV", "MRK", "KO", "PEP", "COST", "AVGO", "TMO", "ADBE", "ACN",
            "NKE", "LLY", "MCD", "CSCO", "ABT", "CRM", "DHR", "VZ", "NFLX",
            "CMCSA", "TXN", "INTC", "ORCL", "AMD", "QCOM", "PM", "HON", "UPS"
        ]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=30))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            factor_scores = {"momentum": {}, "value": {}, "quality": {}}

            # Calculate raw factor scores for each stock
            for symbol in self.universe():
                current_price = data.close(symbol)
                if not current_price:
                    continue

                # Initialize price history for this symbol if needed
                if symbol not in self.price_history:
                    self.price_history[symbol] = deque(maxlen=self.MOMENTUM_DAYS + 1)

                self.price_history[symbol].append(current_price)

                # Momentum: 6-month return (higher is better)
                if len(self.price_history[symbol]) >= self.MOMENTUM_DAYS + 1:
                    past_price = self.price_history[symbol][0]
                    if past_price and past_price > 0:
                        momentum = (current_price / past_price) - 1.0
                        factor_scores["momentum"][symbol] = momentum

                # Value: inverse P/E ratio (lower P/E = higher score)
                pe_ratio = data.pe_ratio(symbol)
                if pe_ratio and pe_ratio > 0:
                    factor_scores["value"][symbol] = 1.0 / pe_ratio

                # Quality: return on equity (higher is better)
                roe = data.roe(symbol)
                if roe and roe > 0:
                    factor_scores["quality"][symbol] = roe

            # Standardize each factor to z-scores for normalization
            def calculate_z_scores(factor_dict):
                if not factor_dict:
                    return {}
                values = list(factor_dict.values())
                mean = sum(values) / len(values)
                variance = sum((v - mean) ** 2 for v in values) / len(values)
                std_dev = variance ** 0.5
                if std_dev < 1e-6:
                    return {k: 0.0 for k in factor_dict}
                return {s: (v - mean) / std_dev for s, v in factor_dict.items()}

            z_momentum = calculate_z_scores(factor_scores["momentum"])
            z_value = calculate_z_scores(factor_scores["value"])
            z_quality = calculate_z_scores(factor_scores["quality"])

            # Combine z-scores with factor weights
            composite_scores = {}
            all_symbols = set(z_momentum.keys()) & set(z_value.keys()) & set(z_quality.keys())

            for symbol in all_symbols:
                composite = (
                    self.MOMENTUM_WEIGHT * z_momentum[symbol] +
                    self.VALUE_WEIGHT * z_value[symbol] +
                    self.QUALITY_WEIGHT * z_quality[symbol]
                )
                composite_scores[symbol] = composite

            if len(composite_scores) < self.TOP_N:
                return {}

            # Select top N stocks by composite score
            sorted_assets = sorted(composite_scores.items(), key=lambda x: x[1], reverse=True)
            top_assets = [symbol for symbol, _ in sorted_assets[:self.TOP_N]]

            # Equal-weight allocation
            weight = 1.0 / self.TOP_N
            return {symbol: weight for symbol in top_assets}
        except Exception:
            return None
