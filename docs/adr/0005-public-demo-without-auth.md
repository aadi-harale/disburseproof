# ADR 0005: A public demo without authentication

**Status:** accepted

## Context

DisburseProof is judged through a public URL and a public repository. Judges and reviewers must be able to open the site and start a run without an account. The site runs in a personal AWS account, so the real risks are not data theft (all data is synthetic) but **cost abuse** (strangers running up the bill), **breaking the golden demo**, and **leaking something from the account or repository**.

## Decision

No login. The single operator is "whoever has the URL". Instead of authentication, these controls limit what an anonymous caller can do:

| Risk | Compensating control |
|---|---|
| Request floods | API Gateway stage throttling: 10 requests/second, burst 20, shared by all callers |
| Cost abuse through writes | Hourly atomic cost guards in DynamoDB (conditional `ADD`, TTL 2 h): 30 runs, 30 races, 20 batches, 60 experiments per hour → HTTP 429; at most 3 concurrent runs and 1 race → HTTP 409 |
| Oversized or malformed input | Strict request schemas: unknown fields rejected, 256 KB body cap, ≤ 500 CSV rows, ID formats for bodies and paths, `duplicate_count` in `1..⌊N/2⌋`, processor enums → HTTP 400 |
| Tampering with the golden demo | No update or delete endpoints; batch IDs are generated server-side and experiments are content-addressed, so no request can overwrite the seeded batch or experiment |
| Leaking internals | Errors return only `{ code, message, request_id }`; run failure messages carry the error type, never raw AWS messages (which can contain ARNs or table names) |
| Browser-side abuse (XSS, clickjacking) | React escaping only (`dangerouslySetInnerHTML` banned by lint), a strict CSP (`default-src 'self'`, `connect-src` = our API), HSTS, `frame-ancestors 'none'` |
| Budget surprises | AWS Budgets alerts and Cost Anomaly Detection on the account (console setup) |

## Alternatives considered

- **Cognito or another login.** Adds friction for every judge and a new failure mode for the demo, and protects synthetic data only. Rejected for this hackathon.
- **An API key in the frontend.** Anything with a `VITE_` prefix ships to every browser, so a key there is public and adds no protection. Rejected.
- **AWS WAF with rate-based rules.** A real per-IP control, but it costs money every month and adds configuration risk on the day. Rejected; the hourly guards and stage throttling cover cost.

## Consequences (accepted risks)

- Anyone can start runs, up to the hourly limits. The counter is a **coarse global limiter, not per-user fairness**: one visitor can use the hour's allowance and others then see a friendly 429.
- The evidence drawer shows Step Functions and Lambda ARNs, which contain the AWS account ID. AWS does not treat account IDs as secrets; no credentials or error internals are exposed.
- Lambdas are not in a VPC (a NAT gateway would cost more than the whole project); the code makes no outbound calls except to AWS APIs.
- If the project continued beyond the hackathon, the first additions would be authentication for write endpoints and per-caller quotas.
