# Strategy 5: Mean-Variance Optimization (Markowitz)

---

## 1 - Intuition

Instead of choosing one "best" asset, this strategy estimates return and risk across a broad multi-asset universe, then solves for portfolio weights that maximize risk-adjusted expected return.

---

## 2 - Concepts in Plain English

- **Mean-variance optimization (Markowitz)**: choose weights that balance expected return and portfolio risk.
- **Expected return (`mu`)**: average recent return estimate for each asset.
- **Covariance (`Sigma`)**: how assets move together; used to estimate diversification and total risk.
- **Risk aversion (`gamma`)**: higher values penalize risk more strongly.
- **Long-only with cap**: no short positions, and no single asset can exceed 25%.

---

## 3 - Optimization Framework

At each rebalance, solve:

```text
maximize    mu^T w - gamma * w^T Sigma w
subject to  sum(w) = 1
            0 <= w_i <= 0.25
```

Where:

- `mu`: estimated expected returns from recent history
- `Sigma`: estimated covariance matrix
- `gamma = 20`: risk aversion
- `w_i <= 0.25`: concentration cap per asset

---

## 4 - Why This Universe and Cadence

- **Universe (14 assets)**: equities, rates, credit, commodities, real estate, and `BTC` so the optimizer has real diversification choices.
- **Cadence (`Cadence()` default)**: recomputes allocation each engine bar; suitable for a rolling optimizer that updates with fresh data.

---

## 5 - Execution Pipeline

```text
1. Update rolling price history for each symbol
2. Keep currently tradable symbols
3. Build aligned price DataFrame from symbols with enough observations
4. Compute returns -> mu and Sigma
5. Solve convex optimization problem (cvxpy + ECOS)
6. Return TargetWeights for non-negligible positive weights
```

Core parts from code:

```python
self.lookback_days = 126
self.min_obs = 60
self.weight_cap = 0.25
self.gamma = 20
...
mu = self._get_mu(price_df)
Sigma = self._get_sigma(price_df)
weights = self._allocate(mu, Sigma)
```

Safety/fallback behavior:

```text
if too few tradable symbols or too little history -> Hold()
if solver fails / invalid solution -> equal weight fallback
```

---

## 6 - Easy Extensions

- Use shrinkage covariance (for example Ledoit-Wolf) for stability.
- Add turnover penalty to reduce rebalance churn.
- Add regime-aware `gamma` (higher in stressed volatility regimes).
- Add minimum weight thresholds and explicit cash sleeve.
