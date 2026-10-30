# Strategy 4: Mean Reversion (RSI) on AAPL with BND Overlay

---

## 1 - Intuition

This strategy assumes short-term overreactions in `AAPL`:

- Oversold -> lean into `AAPL`
- Overbought -> de-risk into `BND`
- Mid-range -> split exposure

---

## 2 - Concepts in Plain English

- **Mean reversion**: when price moves too far from its recent norm, it may move back toward that norm.
- **RSI (Relative Strength Index)**: a 0-100 indicator comparing recent up moves vs down moves.
- **Oversold (`RSI < 30`)**: price fell quickly; strategy assumes potential bounce.
- **Overbought (`RSI > 70`)**: price rose quickly; strategy reduces equity risk.

---

## 3 - Signal Definition

RSI period is 14 days:

```text
RSI = 100 - (100 / (1 + RS))
RS  = avg_gain / avg_loss
```

Allocation rules:

```text
if RSI < 30:  AAPL 80%, BND 20%
if RSI > 70:  BND 100%
else:         AAPL 50%, BND 50%
```

Warm-up behavior:

```text
if RSI not available yet:
    first trade -> BND 100%
    then Hold() until enough history
```

---

## 4 - Why This Universe and Cadence

- **Universe (`AAPL`, `BND`)**: one volatile single-name equity plus a defensive bond anchor.
- **Daily cadence**: RSI is short-horizon and should respond on daily closes.

---

## 5 - Code Walkthrough

```python
self._period = 14
self._prices = deque(maxlen=self._period + 1)
...
rsi = self._compute_rsi()

if rsi is None:
    if self._first_trade:
        self._first_trade = False
        return TargetWeights({"BND": 1.0})
    return Hold()

if rsi < 30:
    return TargetWeights({"AAPL": 0.8, "BND": 0.2})
if rsi > 70:
    return TargetWeights({"BND": 1.0})
return TargetWeights({"AAPL": 0.5, "BND": 0.5})
```

---

## 6 - Easy Extensions

- Add hysteresis (different entry/exit thresholds) to reduce oscillation.
- Add trend filter so oversold buys only occur in non-downtrend regimes.
- Add max position change per bar to smooth turnover.
