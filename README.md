# HQG Dashboard

The **HQG Dashboard** is the internal web platform for the **Husky Quantitative Group** and UConn students.
It provides a unified interface for creating trading strategies, running backtests, and managing live portfolios.

This project is deployed live at [dashboard.uconnquant.com](https://dashboard.uconnquant.com)

---

## Project Overview

A React frontend, published to GitHub Pages, talks to a Python API (FastAPI) backed by
PostgreSQL. The API and its database run with Docker Compose on the HQG VPS, beside the
deployed [hqg-backtester](https://github.com/Husky-Quantitative-Group/hqg-backtester) and
[hqg-engine](https://github.com/Husky-Quantitative-Group/hqg-engine) services that the
dashboard integrates.

The dashboard previously ran on AWS (API Gateway, Lambda, DynamoDB, S3, SSM and
EventBridge, managed with Terraform). The API serves the same routes, responses and
session cookies, so the frontend and the services that verify dashboard sessions work
unchanged. [aws_migration.md](./docs/aws_migration.md) explains how to move the data
across and lists what changed.

### Repository Structure:
```text
.
├── frontend/             # React dashboard UI
├── backend/
│   ├── hqg_dashboard/    # The API, its database schema and operator commands
│   ├── seed/             # Sample strategies for new installs
│   └── tests/
├── dev/                  # Local development helpers (HTTPS for a local engine)
├── docs/                 # Setup, deployment and migration guides
├── docker-compose.yml    # The API and PostgreSQL, as deployed
├── .env.example          # Configuration, copied to .env
└── package.json          # Root scripts (frontend dev helpers)
```

---

## Getting Started

- To run the dashboard locally, read [local_setup.md](./docs/local_setup.md).
- To deploy it to the VPS, read [prod_deployment.md](./docs/prod_deployment.md).
- To move an existing AWS deployment's data, read [aws_migration.md](./docs/aws_migration.md).
