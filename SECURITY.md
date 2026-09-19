# Security policy

DisburseProof is a hackathon sandbox. **All data is synthetic**: the students, names, amounts and schemes are generated or uploaded test data, no money moves, and no bank, Aadhaar or government system is called. There are no user accounts and nothing personal is stored.

## Reporting a vulnerability

Please report security issues privately, not in a public issue:

- GitHub: open a private report under **Security → Report a vulnerability** on this repository (private vulnerability reporting), or
- contact the maintainer, Aadi Harale, through the GitHub profile [@aadi-harale](https://github.com/aadi-harale).

Include what you found, how to reproduce it, and the impact you expect. I aim to acknowledge reports within 3 days. Please do not run load or denial-of-service tests against the live demo; it runs in a personal AWS account.

## In scope

- The public API (`https://5f1ru6pgai.execute-api.ap-south-1.amazonaws.com`) and the site (`https://main.d194gkph6yfxxv.amplifyapp.com`)
- This repository: backend (`backend/`), frontend (`frontend/`), infrastructure (`backend/template.yaml`) and CI
- Examples: bypassing input validation or the hourly cost guards, reading data you should not, leaking internals in errors, XSS, a secret in the repository or its history, over-privileged IAM

## Out of scope

- Volumetric denial of service (the API is throttled at 10 requests/second by design)
- Missing controls listed as accepted risks in the README ("Security and threat model") and [ADR 0005](docs/adr/0005-public-demo-without-auth.md)
- Findings that require AWS account credentials

## How the project handles secrets

The backend needs no secrets: every Lambda uses its own IAM role. The only value shipped to the browser is the public API URL (`VITE_API_URL`). Every commit, on every branch, is scanned by gitleaks in CI.
