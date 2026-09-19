# ADR 0004: Deterministic delivery IDs

**Status:** accepted (a deliberate change from the original brief, which specified uuid4)

## Context

Step Functions retries a Lambda task after transient errors such as `Lambda.ServiceException`. The inject task sends many messages with `SendMessageBatch`. If an attempt sends some messages and then fails, the retry sends them again. With random (uuid4) delivery IDs, the re-sent messages would have *new* IDs. The vulnerable processor, which is idempotent only on the delivery ID, would pay them as new events and inflate every count in the headline table.

## Decision

```
delivery_id = uuid5(DELIVERY_ID_NAMESPACE, "<run_id>:<phase>:<logical_event_id>:<copy>")
```

A retried injection re-sends the *same* deliveries. The worker then treats them exactly like an SQS redelivery: the Deliveries row for that ID already exists, so nothing new is written or counted. The inject task can therefore keep a normal retry policy.

## Consequences

- Injection is idempotent, and the two copies of a Phase A event still have different IDs (copy 1 and copy 2), so they remain two genuine deliveries of one logical event.
- IDs are still UUIDs, so the data model and the Deliveries sort key `DELIVERY#<delivery_id>` are unchanged.
- Delivery IDs are predictable from public inputs. That is fine in a sandbox; they are identifiers, not secrets.

## Alternatives considered

- **uuid4 and no retry on the inject task.** Correct, but a transient Lambda error would fail the whole run.
