from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView
import numpy as np
import pandas as pd
import cvxpy as cp
from collections import deque


class MeanVar(Strategy):
    
    def __init__(self):

        # Strategy parameters
        self.lookback_days = 126  # ~6 months of history
        self.weight_cap = 0.25    # max .25 in any single asset
        self.min_obs = 60         # require ~3 months of data minimum
        self.gamma = 20           # risk aversion parameter
        
        # Store price history internally
        # Structure: {"SPY": deque([price1, price2, ...], maxlen=lookback_days), ...}
        self.price_history: dict[str, deque] = {}
        
    def universe(self) -> list[str]:
        return [
            "SPY",  # US large-cap
            "IWM",  # US small-cap
            "EFA",  # Developed ex-US
            "EEM",  # Emerging markets
            "QQQ",  # US large-cap growth tilt
            "VNQ",  # US REITs
            "GLD",  # Gold
            "DBC",  # Broad commodities
            "AGG",  # US aggregate bonds
            "LQD",  # Investment-grade corporates
            "HYG",  # High yield
            "TLT",  # Long Treasuries
            "TIP",  # Treasury inflation protected securities
            "BTC"   # Bitcoin
        ]
    
    def cadence(self) -> Cadence:
        return Cadence()
    
    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        self._update_history(data)
        
        tradable = [sym for sym in self.universe() if data.has(sym) and data.close(sym) is not None]
        
        if len(tradable) < 3:
            return None
        
        # Build price DataFrame from history
        price_df = self._build_price_dataframe(tradable)
        
        if price_df is None or price_df.shape[0] < self.min_obs:
            return None  # Insufficient history
        
        # Calculate expected returns and covariance
        mu = self._get_mu(price_df)
        Sigma = self._get_sigma(price_df)
        
        # Optimize portfolio weights
        weights = self._allocate(mu, Sigma)
        
        if weights is None or len(weights) == 0:
            return None
        
        # Convert to weight dictionary, filtering negligible weights
        weight_dict = {}
        for sym, w in zip(tradable, weights):
            if w > 1e-6:
                weight_dict[sym] = float(w)
        
        return weight_dict
    
    def _update_history(self, data: Slice) -> None:
        for symbol in self.universe():
            close_price = data.close(symbol)
            if close_price is not None:
                if symbol not in self.price_history:
                    self.price_history[symbol] = deque(maxlen=self.lookback_days)
                self.price_history[symbol].append(close_price)
    
    def _build_price_dataframe(self, symbols: list[str]) -> pd.DataFrame | None:
        histories = {}
        for sym in symbols:
            if sym in self.price_history and len(self.price_history[sym]) >= self.min_obs:
                histories[sym] = list(self.price_history[sym])
        
        if len(histories) < 3:
            return None
        
        # Find minimum length across all symbols
        min_len = min(len(hist) for hist in histories.values())
        
        # Build DataFrame with aligned histories (take last min_len observations)
        aligned = {sym: hist[-min_len:] for sym, hist in histories.items()}
        df = pd.DataFrame(aligned)
        
        return df if not df.empty else None
    
    def _get_mu(self, price_df: pd.DataFrame) -> np.ndarray:
        rets = price_df.pct_change().dropna(how="all").fillna(0.0)
        if rets.shape[0] == 0:
            return np.ones(price_df.shape[1]) / max(1, price_df.shape[1])
        mu = rets.mean(axis=0).values
        return mu
    
    def _get_sigma(self, price_df: pd.DataFrame) -> np.ndarray:
        rets = price_df.pct_change().dropna(how="all").fillna(0.0)
        if rets.shape[0] == 0 or rets.shape[1] == 0:
            return np.eye(price_df.shape[1])
        Sigma = np.cov(rets.values, rowvar=False, ddof=1)
        return Sigma
    
    def _allocate(self, mu: np.ndarray, Sigma: np.ndarray) -> np.ndarray | None:
        N = len(mu)
        if N == 0:
            return None
        
        w = cp.Variable(N)
        objective = cp.Maximize(mu @ w - self.gamma * cp.quad_form(w, Sigma))
        
        constraints = [
            cp.sum(w) == 1,          # Fully invested
            w >= 0,                  # Long-only (no shorts)
            w <= self.weight_cap     # Position size limits
        ]
        
        prob = cp.Problem(objective, constraints)
        
        try:
            prob.solve(solver=cp.ECOS, verbose=False)
        except Exception:
            return np.ones(N) / N
        
        if w.value is None or np.any(np.isnan(w.value)):
            return np.ones(N) / N
        
        return np.asarray(w.value, dtype=float).ravel()