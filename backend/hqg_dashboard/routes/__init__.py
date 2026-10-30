from . import (
    accounts,
    admin,
    artifacts,
    auth,
    backtests,
    meta,
    permissions,
    storage,
    strategies,
    users,
)

ROUTERS = [
    meta.router,
    auth.router,
    strategies.router,
    artifacts.router,
    permissions.router,
    users.router,
    admin.router,
    backtests.router,
    storage.router,
    accounts.router,
]
