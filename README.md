# HQG Dashboard

The **HQG Dashboard** is the internal web platform for the **Husky Quantitative Group** and UConn students.  
It provides a unified interface for creating trading strategies, running backtests, and managing live portfolios.

This project is deployed live at [dashboard.uconnquant.com](https://dashboard.uconnquant.com)

---

## Project Overview

This project uses a React frontend, AWS serverless backend, and Terraform for IaC. The frontend dashboard also integrates deployed instances of the [hqg-backtester](https://github.com/Husky-Quantitative-Group/hqg-backtester) and [hqg-engine](https://github.com/Husky-Quantitative-Group/hqg-engine) services.

### System High-Level Design:

<p align="center">
  <img height="600" alt="hqg-dash-high-level-design" src="./docs/designs/hld-20260208" />
</p>


### Repository Structure:
```text
.
├── frontend/        # React dashboard UI
├── aws/             # AWS source code
├── infra/           # Terraform infrastructure
├── docs/            # Setup and architecture documentation
└── package.json     # Root scripts (frontend dev helpers)
```

---

## Getting Started

Before contributing, please read our [contributing guidelines](./docs/CONTRIBUTING.md).

To deploy the dashboard locally, read [local_setup.md](./docs/local_setup.md)
