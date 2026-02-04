"""
HQG Seed Strategies

A curated collection of 10 systematic trading strategies designed to teach
quantitative finance and algorithmic trading concepts progressively.
"""

from .01_buy_and_hold_spy import BuyAndHoldSpy
from .02_sixty_forty_portfolio import SixtyFortyPortfolio
from .03_simple_momentum import SimpleMomentum
from .04_pairs_trading import PairsTrading
from .05_moving_average_crossover import MovingAverageCrossover
from .06_volatility_targeting import VolatilityTargeting
from .07_equal_risk_contribution import EqualRiskContribution
from .08_multi_factor_ranking import MultiFactorRanking
from .09_sector_rotation import SectorRotation
from .10_mean_variance_optimization import MeanVarianceOptimization

__all__ = [
    "BuyAndHoldSpy",
    "SixtyFortyPortfolio",
    "SimpleMomentum",
    "PairsTrading",
    "MovingAverageCrossover",
    "VolatilityTargeting",
    "EqualRiskContribution",
    "MultiFactorRanking",
    "SectorRotation",
    "MeanVarianceOptimization",
]

# Strategy metadata for easy reference
STRATEGIES = [
    {
        "name": "Buy and Hold SPY",
        "class": BuyAndHoldSpy,
        "difficulty": "Beginner",
        "level": 1,
        "file": "01_buy_and_hold_spy.py",
    },
    {
        "name": "60/40 Portfolio",
        "class": SixtyFortyPortfolio,
        "difficulty": "Beginner",
        "level": 1,
        "file": "02_sixty_forty_portfolio.py",
    },
    {
        "name": "Simple Momentum",
        "class": SimpleMomentum,
        "difficulty": "Beginner",
        "level": 1,
        "file": "03_simple_momentum.py",
    },
    {
        "name": "Pairs Trading",
        "class": PairsTrading,
        "difficulty": "Early Intermediate",
        "level": 2,
        "file": "04_pairs_trading.py",
    },
    {
        "name": "Moving Average Crossover",
        "class": MovingAverageCrossover,
        "difficulty": "Early Intermediate",
        "level": 2,
        "file": "05_moving_average_crossover.py",
    },
    {
        "name": "Volatility Targeting",
        "class": VolatilityTargeting,
        "difficulty": "Intermediate",
        "level": 3,
        "file": "06_volatility_targeting.py",
    },
    {
        "name": "Equal Risk Contribution",
        "class": EqualRiskContribution,
        "difficulty": "Intermediate",
        "level": 3,
        "file": "07_equal_risk_contribution.py",
    },
    {
        "name": "Multi-Factor Ranking",
        "class": MultiFactorRanking,
        "difficulty": "Advanced Intermediate",
        "level": 4,
        "file": "08_multi_factor_ranking.py",
    },
    {
        "name": "Sector Rotation",
        "class": SectorRotation,
        "difficulty": "Advanced Intermediate",
        "level": 4,
        "file": "09_sector_rotation.py",
    },
    {
        "name": "Mean-Variance Optimization",
        "class": MeanVarianceOptimization,
        "difficulty": "Advanced",
        "level": 5,
        "file": "10_mean_variance_optimization.py",
    },
]
