"""
Strategy 10: Mean-Variance Optimization (Markowitz)

Constructs optimal portfolio on the efficient frontier by maximizing Sharpe ratio.
Calculates expected returns and covariance matrix from historical data.
Uses Monte Carlo sampling to approximate the optimal weights.
"""
from datetime import timedelta
from collections import deque
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class MeanVarianceOptimization(Strategy):
    LOOKBACK_DAYS = 252
    RISK_FREE_RATE = 0.03  # 3% annual
    TRADING_DAYS_PER_YEAR = 252
    REGULARIZATION = 0.01  # Added to covariance diagonal for numerical stability

    def __init__(self):
        # Store price history for each symbol
        self.price_history = {}

    def universe(self) -> list[str]:
        return ["SPY", "EFA", "EEM", "TLT", "IEF", "GLD"]

    def cadence(self) -> Cadence:
        return Cadence(bar_size=timedelta(days=30))

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        try:
            symbols = self.universe()
            n_assets = len(symbols)

            returns_matrix = {symbol: [] for symbol in symbols}

            # Update price history for all symbols
            for symbol in symbols:
                price = data.close(symbol)
                if price is None:
                    continue

                # Initialize price history for this symbol if needed
                if symbol not in self.price_history:
                    self.price_history[symbol] = deque(maxlen=self.LOOKBACK_DAYS)

                self.price_history[symbol].append(price)

            # Calculate returns from stored price history
            for symbol in symbols:
                if symbol not in self.price_history:
                    continue

                if len(self.price_history[symbol]) < self.LOOKBACK_DAYS * 0.8:
                    continue

                prices_list = list(self.price_history[symbol])
                for i in range(len(prices_list) - 1):
                    price_yesterday = prices_list[i]
                    price_today = prices_list[i + 1]

                    if price_yesterday > 0:
                        ret = (price_today / price_yesterday) - 1.0
                        returns_matrix[symbol].append(ret)

            for symbol in symbols:
                if len(returns_matrix[symbol]) < self.LOOKBACK_DAYS * 0.8:
                    return None

            # Calculate expected returns (annualized)
            expected_returns = {}
            for symbol in symbols:
                mean_daily_return = sum(returns_matrix[symbol]) / len(returns_matrix[symbol])
                expected_returns[symbol] = mean_daily_return * self.TRADING_DAYS_PER_YEAR

           # Calculate covariance matrix (annualized)
            covariance = {}
            for i, sym1 in enumerate(symbols):
                covariance[sym1] = {}
                for j, sym2 in enumerate(symbols):
                    returns1 = returns_matrix[sym1]
                    returns2 = returns_matrix[sym2]

                    mean1 = sum(returns1) / len(returns1)
                    mean2 = sum(returns2) / len(returns2)

                    # Covariance formula: E[(X - μ_x)(Y - μ_y)]
                    cov = sum(
                        (r1 - mean1) * (r2 - mean2)
                        for r1, r2 in zip(returns1, returns2)
                    ) / len(returns1)

                    cov_annual = cov * self.TRADING_DAYS_PER_YEAR

                    # Add regularization to diagonal for numerical stability
                    if sym1 == sym2:
                        cov_annual += self.REGULARIZATION

                    covariance[sym1][sym2] = cov_annual

            # Optimize for maximum Sharpe ratio using Monte Carlo
            # (Full implementation would use quadratic programming) just keeping it simple for now
            best_sharpe = -float('inf')
            best_weights = None

            import random
            random.seed(42)

            for _ in range(10000):  # Sample 10,000 random portfolios
                # Generate random weights that sum to 1
                raw_weights = [random.random() for _ in range(n_assets)]
                total = sum(raw_weights)
                weights = [w / total for w in raw_weights]

                # Calculate portfolio return
                portfolio_return = sum(
                    weights[i] * expected_returns[symbols[i]]
                    for i in range(n_assets)
                )

                # Calculate portfolio variance: w^T * Σ * w
                portfolio_variance = 0
                for i in range(n_assets):
                    for j in range(n_assets):
                        portfolio_variance += (
                            weights[i] * weights[j] *
                            covariance[symbols[i]][symbols[j]]
                        )

                portfolio_std = portfolio_variance ** 0.5

                # Sharpe ratio: (return - risk_free_rate) / volatility
                if portfolio_std > 0:
                    sharpe = (portfolio_return - self.RISK_FREE_RATE) / portfolio_std

                    if sharpe > best_sharpe:
                        best_sharpe = sharpe
                        best_weights = weights

            if best_weights:
                return {
                    symbols[i]: best_weights[i]
                    for i in range(n_assets)
                }

            return None

        except Exception:
            return None
