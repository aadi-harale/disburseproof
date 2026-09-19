# ADR 0002: Transactional idempotency in one TransactWriteItems

**Status:** accepted

## Context

A payment is real when four things are true: the entitlement is claimed, the budget is debited, the ledger has the effect, and the delivery is recorded. If these are separate writes, a crash, timeout or concurrent delivery between them leaves the system in a state that is neither "paid" nor "not paid". Two common designs fail:

- **Check-then-write:** read the idempotency record, and pay if it is absent. Two concurrent deliveries can both read "absent" before either writes, and both pay. The naive processor in the Race Lab shows this.
- **Write the claim first, pay second:** a crash after the claim and before the payment leaves the entitlement "claimed but unpaid" forever; every retry is now suppressed and the student is never paid.

## Decision

The protected processor makes all four writes in **one DynamoDB `TransactWriteItems`**:

| # | Item | Condition |
|---|---|---|
| 1 | Put `Idempotency` record | `attribute_not_exists(idem_key)` |
| 2 | Update `Runs`: debit budget, count the delivery | `budget_remaining_paise >= :amount` |
| 3 | Put `Ledger` effect | none |
| 4 | Put `Deliveries` row | `attribute_not_exists(sk)` |

Either all four commit or none do. On `TransactionCanceledException`, `CancellationReasons` (one per item, in order) decide the outcome, in this precedence:

1. Item 4 failed: this exact delivery was already processed (an SQS redelivery). Acknowledge; write nothing.
2. Item 1 failed: a business duplicate. A second, small transaction records `DUPLICATE_SUPPRESSED` and counts the delivery.
3. Item 2 failed: no budget. Record `BUDGET_EXHAUSTED` the same way.
4. `TransactionConflict`: the Runs item is busy. Retry with full-jitter exponential backoff (6 attempts, 1 s cap), then report the message as a batch item failure so SQS redelivers it.

A redelivery also fails item 1, which is why item 4 is checked first.

## Consequences

- There is no instant at which a crash can leave a key claimed but unpaid, or paid but unclaimed.
- The Runs item is updated by every delivery, so it is a deliberate hot key. Conflicts are expected at 5 concurrent workers; they are retried and emitted as the `TransactionConflictRetries` metric. This would not scale to thousands of payments per second; a production design would shard the budget or reserve it per batch partition.
- Transactions cost twice the write capacity of plain writes. On-demand billing at sandbox volume makes this negligible.

## Alternatives considered

- **AWS Lambda Powertools idempotency utility.** It is a good library, but it makes a *function invocation* idempotent, keyed on the event payload. We need idempotency of a *business effect*, keyed on the entitlement, and atomic with the budget and the ledger. Implementing and explaining it ourselves is the point of this project, so Powertools is used for logging and metrics only.
- **Conditional writes without a transaction.** Cannot make the budget debit and the ledger effect atomic with the claim.
