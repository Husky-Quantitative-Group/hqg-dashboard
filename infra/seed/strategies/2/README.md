# Strategy 2: Simple Momentum (SPY vs BND)

---

## 1 - Intuition

This strategy rotates between a risk asset (`SPY`) and a defensive asset (`BND`) using short-term momentum.

- If `SPY` has positive 20-day return, stay risk-on (`SPY`).
- If momentum turns negative, move risk-off (`BND`).

---

## 2 - Concepts in Plain English

- **Momentum**: assets that have been going up recently sometimes keep going up for a while.
- **SPY**: stock-market exposure (risk-on).
- **BND**: US bond-market exposure (usually lower volatility; risk-off).
- **Lookback window (20 days)**: how far back we measure recent performance.

---

## 3 - Signal Definition

Momentum over a 20-day lookback:

```text
momentum = (price_today / price_20_days_ago) - 1
```

Decision rule:

```text
if momentum > 0: 100% SPY
else:            100% BND
```

Warm-up behavior:

```text
if fewer than 21 prices:
    hold 100% BND
```

---

## 4 - Why This Universe and Cadence

- **Universe (`SPY`, `BND`)**: clean risk-on/risk-off pair; easy to reason about.
- **Daily cadence**: a 20-day momentum signal should update daily; weekly would react later.

---

## 5 - Code Walkthrough

```python
self._lookback = 20
self._prices = deque(maxlen=self._lookback + 1)
...
price = data.close("SPY")
if price is None:
    return Hold()

self._prices.append(price)

if len(self._prices) < self._lookback + 1:
    return TargetWeights({"BND": 1.0})

momentum = (self._prices[-1] / self._prices[0]) - 1.0
if momentum > 0:
    return TargetWeights({"SPY": 1.0})
return TargetWeights({"BND": 1.0})
```

---

## 6 - Easy Extensions

- Add a neutral zone (for example `momentum > 1%` to switch risk-on).
- Add transaction cost checks before switching.
- Replace binary allocation with graded sizing (for example `70/30`, `50/50`, `30/70`).
