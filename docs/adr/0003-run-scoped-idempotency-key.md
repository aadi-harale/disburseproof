# ADR 0003: Run-scoped idempotency key

**Status:** accepted

## Context

The idempotency key must name the business effect, not the message. An entitlement is identified by scheme, beneficiary, academic year and installment. Anything that changes on a retry, such as the SQS message ID, the delivery ID, a timestamp or a retry count, must not be part of the key, or every retry would look like a new payment.

The sandbox also needs to run the same experiment many times. If the key were the business identity alone, the second run of the demo would find every entitlement already claimed by the first run and suppress everything.

## Decision

```
idempotency key = <run_id>#<scheme_id>#<beneficiary_id>#<academic_year>#INST-<installment>
```

The `run_id` prefix makes every run an isolated sandbox universe. Within a run, the key is exactly the business identity. `build_idempotency_key()` takes only those five arguments; there is no parameter through which a delivery or message ID could enter.

## Consequences

- Replaying the same experiment later is not suppressed by earlier runs, and runs can execute concurrently without interfering.
- **In production the key would be the business identity alone**, with no run prefix: an entitlement must be paid once ever, not once per run. This is a sandbox decision and is stated in the README.
- Keys never contain `#` inside a component (validated), so two different entitlements cannot produce the same key.
