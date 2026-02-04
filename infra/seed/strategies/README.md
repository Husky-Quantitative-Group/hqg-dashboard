# HQG Seed Strategies

A curated collection of 10 systematic trading strategies designed to teach quantitative finance and algorithmic trading concepts progressively.

## Learning Progression

These strategies are ordered by complexity and introduce key concepts in systematic trading:

### **Beginner Level (1-3)** - Core Concepts

#### 1. **Buy and Hold SPY**
- **File:** `01_buy_and_hold_spy.py`
- **Concepts:** Passive investing, long-term equity exposure
- **Complexity:** ⭐
- **Universe:** SPY

#### 2. **60/40 Portfolio**
- **File:** `02_sixty_forty_portfolio.py`
- **Concepts:** Asset allocation, diversification, rebalancing
- **Complexity:** ⭐
- **Universe:** SPY, IEF

#### 3. **Simple Momentum**
- **File:** `03_simple_momentum.py`
- **Concepts:** Momentum effect, cross-sectional ranking, equal-weight allocation
- **Complexity:** ⭐⭐
- **Universe:** SPY, QQQ, IWM, EFA, EEM, TLT, IEF, GLD, DBC

---

### **Early Intermediate (4-5)** - Statistical Foundations

#### 4. **Pairs Trading**
- **File:** `04_pairs_trading.py`
- **Concepts:** Mean reversion, z-scores, statistical arbitrage, long/short
- **Complexity:** ⭐⭐
- **Universe:** SPY, QQQ

#### 5. **Moving Average Crossover**
- **File:** `05_moving_average_crossover.py`
- **Concepts:** Trend following, technical indicators, SMA 50/200, Golden/Death Cross
- **Complexity:** ⭐⭐
- **Universe:** SPY

---

### **Intermediate (6-7)** - Risk & Portfolio Construction

#### 6. **Volatility Targeting**
- **File:** `06_volatility_targeting.py`
- **Concepts:** Dynamic position sizing, realized volatility, risk management, inverse vol scaling
- **Complexity:** ⭐⭐⭐
- **Universe:** SPY

#### 7. **Equal Risk Contribution**
- **File:** `07_equal_risk_contribution.py`
- **Concepts:** Risk parity, inverse volatility weighting, risk decomposition
- **Complexity:** ⭐⭐⭐
- **Universe:** SPY, EFA, TLT, IEF, GLD

---

### **Advanced Intermediate (8-9)** - Factor & Multi-Signal

#### 8. **Multi-Factor Ranking**
- **File:** `08_multi_factor_ranking.py`
- **Concepts:** Factor investing, z-score normalization, composite scoring, Fama-French factors
- **Complexity:** ⭐⭐⭐⭐
- **Universe:** SPY, QQQ, IWM, XLF, XLE, XLK, XLV, XLI, XLY, XLP, EFA, EEM

#### 9. **Sector Rotation**
- **File:** `09_sector_rotation.py`
- **Concepts:** Sector rotation, economic cycles, relative strength, multi-timeframe analysis
- **Complexity:** ⭐⭐⭐⭐
- **Universe:** XLK, XLV, XLF, XLY, XLC, XLI, XLP, XLE, XLU, XLRE, XLB

---

### **Advanced (10)** - Portfolio Optimization

#### 10. **Mean-Variance Optimization**
- **File:** `10_mean_variance_optimization.py`
- **Concepts:** Modern Portfolio Theory, efficient frontier, Sharpe ratio, covariance matrix, quadratic optimization
- **Complexity:** ⭐⭐⭐⭐⭐
- **Universe:** SPY, EFA, EEM, TLT, IEF, GLD

---

## Key Concepts Covered

| Concept | Strategies |
|---------|-----------|
| **Momentum** | 3, 8, 9 |
| **Mean Reversion** | 4 |
| **Trend Following** | 5 |
| **Risk Management** | 6, 7 |
| **Factor Investing** | 8 |
| **Portfolio Optimization** | 10 |
| **Long/Short Trading** | 4 |
| **Multi-Asset Allocation** | 2, 7, 10 |
| **Volatility Targeting** | 6, 7 |
| **Cross-Sectional Analysis** | 3, 8, 9 |

---

## Usage

Each strategy is a standalone Python file implementing the `Strategy` interface from `hqg-algorithms`:

```python
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView

class MyStrategy(Strategy):
    def universe(self) -> list[str]:
        # Define securities to trade
        pass

    def cadence(self) -> Cadence:
        # Define rebalancing frequency
        pass

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        # Implement trading logic
        pass
```

---

## Learning Path Recommendations

1. **Start with Beginner strategies** (1-3) to understand basic portfolio construction
2. **Progress to Early Intermediate** (4-5) to learn statistical trading concepts
3. **Move to Intermediate** (6-7) to master risk management
4. **Tackle Advanced Intermediate** (8-9) for multi-factor and tactical strategies
5. **Finish with Advanced** (10) to understand portfolio optimization theory

---

## Notes

- All strategies use daily or weekly rebalancing to keep transaction costs manageable
- Strategies include comprehensive comments explaining the logic and key concepts
- Each file is self-contained and can be run independently
- Strategies use realistic parameters based on academic research and practitioner experience

---

## Further Reading

- **Momentum:** Jegadeesh & Titman (1993)
- **Pairs Trading:** Gatev, Goetzmann & Rouwenhorst (2006)
- **Risk Parity:** Qian (2005)
- **Mean-Variance Optimization:** Markowitz (1952)
- **Factor Investing:** Fama & French (1992, 2015)
