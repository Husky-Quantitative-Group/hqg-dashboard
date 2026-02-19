# Terraform Apply IAM Setup

This folder contains the IAM documents for the Terraform apply role.

- Role name: `hqg-dash-terraform-deploy`
- Policy name: `hqg-dash-deploy`
- Permission policy file: `deploy_iam_policy.json`
- Trust policy file: `trust_policy.json`
- GitHub variable used by workflow: `AWS_DEPLOY_ROLE_TO_ASSUME`

## Chronological Setup

1. In AWS IAM, confirm GitHub OIDC provider exists (one-time per account).
   - Provider URL: `https://token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`

2. In AWS IAM, create a customer-managed policy named `hqg-dash-deploy`.
   - Paste JSON from `deploy_iam_policy.json`.
   - Create policy.

3. In AWS IAM, create role `hqg-dash-terraform-deploy`.
   - Trusted entity type: `Web identity`
   - Identity provider: `token.actions.githubusercontent.com`
   - Audience: `sts.amazonaws.com`
   - Create role.

4. Open role `hqg-dash-terraform-deploy` and replace trust relationship.
   - Paste JSON from `trust_policy.json`.
   - Save.

5. Attach policy `hqg-dash-deploy` to role `hqg-dash-terraform-deploy`.

6. In GitHub repository settings, add Actions variable:
   - `AWS_DEPLOY_ROLE_TO_ASSUME = arn:aws:iam::016299216645:role/hqg-dash-terraform-deploy`

7. Ensure your apply workflow uses this variable when configuring AWS credentials.
   - Example workflow file expected by trust policy: `.github/workflows/terraform-apply.yml`

8. Run a controlled test on `prod` with branch protection and approvals enabled.

## Notes

- This role is intentionally stronger than plan role; keep it scoped to apply only.
- `trust_policy.json` pins access to `.github/workflows/terraform-apply.yml` on `prod`.
