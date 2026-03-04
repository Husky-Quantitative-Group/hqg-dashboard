# Strategy 3: SMA Crossover (QQQ vs AGG)

---

## 1 - Intuition

This is a trend-following switch:

- Strong equity trend (`fast SMA > slow SMA`) -> hold `QQQ`
- Weak or broken trend -> rotate to `AGG`

`QQQ` is the growth/risk leg and `AGG` is the capital-preservation leg.

---

## 2 - Concepts in Plain English

- **SMA (Simple Moving Average)**: the average of recent prices over a fixed window.
- **Fast SMA (10-week)**: reacts quicker to new moves.
- **Slow SMA (30-week)**: smoother and slower, represents the longer trend.
- **Crossover**: when fast SMA goes above slow SMA, trend is considered bullish.

---

## 3 - Signal Definition

Using weekly closes on `QQQ`:

```text
fast_sma = average(last 10 weeks)
slow_sma = average(last 30 weeks)
```

Decision rule:

```text
if fast_sma > slow_sma: 100% QQQ
else:                   100% AGG
```

Warm-up behavior:

```text
if fewer than 30 weekly prices:
    hold 100% AGG
```

---

## 4 - Why This Universe and Cadence

- **Universe (`QQQ`, `AGG`)**: high-beta growth exposure paired with broad bond defense.
- **Weekly cadence**: SMA crossover is slower by design; weekly bars reduce noise and turnover.

---

## 5 - Code Walkthrough

```python
self._fast_len = 10
self._slow_len = 30
self._prices = deque(maxlen=self._slow_len)
...
price = data.close("QQQ")
if price is None:
    return Hold()

self._prices.append(price)
if len(self._prices) < self._slow_len:
    return TargetWeights({"AGG": 1.0})

prices_list = list(self._prices)
fast_sma = sum(prices_list[-self._fast_len:]) / self._fast_len
slow_sma = sum(prices_list) / self._slow_len
```

---

## 6 - Easy Extensions

- Add a buffer (`fast_sma > slow_sma * 1.005`) to reduce whipsaws.
- Require cross confirmation for 2 consecutive bars.
- Use EMAs instead of SMAs for faster adaptation.
