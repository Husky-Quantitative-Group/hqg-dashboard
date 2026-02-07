# Lambda Layers

This repository uses **AWS Lambda Layers** to manage Python dependencies that are shared across Lambdas (e.g. JWT libraries).

## Why Lambda Layers

* Keeps Lambda source code clean (no vendored `site-packages`)
* Avoids committing large dependency trees to git
* Allows reuse of the same dependency set across multiple Lambdas
* Makes upgrades explicit and centralized

## How Layers Are Used Here

* Each folder under `lambda_layers/` represents **one Lambda Layer**
* Each layer contains:

  * `requirements.txt` – the **source of truth** for dependencies
  * `build/` – generated artifacts (ignored by git)

Example:

```
aws/lambda_layers/
  pyjwt/
    requirements.txt
    build/
      python/
      pyjwt-layer.zip
```

## Build Flow

1. Install dependencies listed in `requirements.txt` into a `python/` directory
2. Zip the directory into a layer artifact
3. Terraform uploads the zip and attaches the layer to Lambdas

All build output lives in `build/` and is **not committed**.

## When to Add a New Layer

Create a new folder under `lambda_layers/` if:

* A dependency is used by more than one Lambda, or
* The dependency is non-trivial (auth, crypto, SDKs, etc.)

Otherwise, keep Lambdas dependency-free where possible.