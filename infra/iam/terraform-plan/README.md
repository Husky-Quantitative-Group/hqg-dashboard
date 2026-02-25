# Terraform Plan IAM Setup

This folder contains the IAM documents for the read-only Terraform plan role.

- Role name: `hqg-dash-terraform-plan`
- Policy name: `hqg-dash-plan`
- Permission policy file: `plan_iam_policy.json`
- Trust policy file: `trust_policy.json`
- GitHub variable used by workflow: `AWS_PLAN_ROLE_TO_ASSUME`

## Chronological Setup

1. In AWS IAM, create the GitHub OIDC provider (one-time per account).
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

2. In AWS IAM, create a customer-managed policy named `hqg-dash-plan`.
   - Paste JSON from `plan_iam_policy.json`.
   - Create policy.

3. In AWS IAM, create role `hqg-dash-terraform-plan`.
   - Trusted entity type: `Web identity`
   - Identity provider: `token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
   - Create role (temporary/default trust is fine for now).

4. Open role `hqg-dash-terraform-plan` and replace trust relationship.
   - Paste JSON from `trust_policy.json`.
   - Save.

5. Attach policy `hqg-dash-plan` to role `hqg-dash-terraform-plan`.

6. In GitHub repository settings, add Actions variable:
   - `AWS_PLAN_ROLE_TO_ASSUME = arn:aws:iam::016299216645:role/hqg-dash-terraform-plan`

7. Optional: ensure `AWS_REGION` is set in repo variables (workflow defaults to `us-east-1`).

8. Validate by pushing a commit to `main` that changes `infra/**`.
   - Confirm `.github/workflows/terraform-plan.yml` assumes this role and uploads plan output.

## Notes

- This role is intentionally minimal/read-only for the current plan flow.
- `trust_policy.json` pins access to `.github/workflows/terraform-plan.yml`.
