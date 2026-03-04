# Strategy 1: Buy & Hold SPY

---

## 1 - Intuition

This is the baseline strategy: buy `SPY` once, then do nothing.

If a more complex strategy cannot beat this after costs and risk adjustments, the added complexity is usually not worth it.

---

## 2 - Core Building Blocks (Used By All Seed Strategies)

### 2.1 Universe

`universe` is the list of symbols the strategy is allowed to trade.

```python
universe = ["SPY"]
```

Only `SPY` can appear in orders.

### 2.2 Cadence

`cadence` controls how often `on_data` runs.

```python
cadence = Cadence(bar_size=BarSize.WEEKLY)
```

Weekly cadence is enough for buy-and-hold because there is no high-frequency decision to make.

### 2.3 Signal Types

`on_data(...)` returns a `Signal`:

- `TargetWeights({...})` means "rebalance portfolio to these weights"
- `Hold()` means "do nothing"

### 2.4 Beginner Glossary

- **SPY**: an ETF that tracks the S&P 500 (large US companies).
- **Buy and hold**: buy once, then stay invested instead of timing entries/exits.
- **Weight**: fraction of total portfolio in one asset (for example, `1.0` = 100%).

---

## 3 - Implementation Logic

```python
class BuyAndHoldSpy(Strategy):
    universe = ["SPY"]
    cadence = Cadence(bar_size=BarSize.WEEKLY)

    def __init__(self):
        self._initialized = False

    def on_data(self, data: Slice, portfolio: PortfolioView) -> Signal:
        if not self._initialized:
            self._initialized = True
            return TargetWeights({"SPY": 1.0})
        return Hold()
```

State machine:

```text
Start (not initialized)
  -> set SPY = 100%
  -> initialized = True
Every later bar
  -> Hold()
```

This keeps turnover near zero after the first rebalance.

---

## 4 - Why This Setup

- **Universe (`SPY`)**: broad US equity market proxy.
- **Cadence (weekly)**: avoids unnecessary processing/trading for a static allocation.
- **Single-shot allocation**: perfect baseline for benchmarking active logic.

---

## 5 - Easy Extensions

```python
# Add a bond sleeve
return TargetWeights({"SPY": 0.8, "IEF": 0.2})

# Rebalance once per month instead of "set once then hold"
cadence = Cadence(bar_size=BarSize.MONTHLY)
```
