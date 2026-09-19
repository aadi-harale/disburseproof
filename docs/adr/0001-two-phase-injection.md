# ADR 0001: Two-phase injection

**Status:** accepted

## Context

The experiment delivers N logical payment events, D of them twice, to a processor with a fixed budget of N payments. SQS Standard delivers at least once and does not preserve order. If all N + D deliveries were sent together, the budget would run out at an order-dependent moment. A duplicate that arrived after exhaustion would be rejected instead of paid, so the number of double-paid and starved students would change from run to run. A demo whose headline number moves every time is not evidence.

## Decision

Inject in two phases, orchestrated by Step Functions:

- **Phase A (the retry wave):** each of the D duplicated logical events is delivered twice (2D deliveries).
- **Phase B:** starts only after every Phase A delivery is *recorded* (the run's `delivered_count` reaches 2D). It delivers the other N − D events once.

The drain check reads `delivered_count`, which the worker increments in the same DynamoDB transaction that writes the Deliveries row. Approximate SQS queue depths are shown for context and are never the signal.

## Consequences

- With equal amounts and 1 ≤ D ≤ ⌊N/2⌋, a vulnerable processor always pays 2D times in Phase A and has budget left for N − 2D of the N − D Phase B events. Exactly D students receive ₹0 (12 in the demo).
- *Which* D students are starved still depends on SQS delivery order, and the UI says so.
- With unequal amounts (a CSV batch), the starvation count is no longer fixed. The evaluator still reports the truth; the UI labels the count as order-dependent.
- The design models a realistic incident: a first wave of payments was retried before the rest of the batch went out.

## Alternatives considered

- **One wave, FIFO queue.** FIFO would make order deterministic, but it removes the at-least-once, unordered behaviour the sandbox exists to exercise, and FIFO deduplication would hide the duplicates.
- **One wave, report ranges.** Honest but weak: "between 6 and 12 students were starved" does not make a clear story or a repeatable test.
