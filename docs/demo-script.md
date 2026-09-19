# Demo video script (under 3 minutes)

Record at 1440×900 or larger, light theme, the live Amplify URL. Start both runs before recording if you want a fast cut; the live grid is the part worth showing in real time.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | Overview hero | "100 eligible students, 112 payment events. Retries delivered 12 events twice. How many students got paid exactly once? DisburseProof answers that from the ledger, on real AWS." |
| 0:15–0:50 | Click **Run vulnerable processor** → live run page | "Phase A is the retry wave: 12 events, each delivered twice. The vulnerable processor is idempotent on the delivery ID, so a retry with a new ID pays again. Amber tiles: paid twice." Wait for Phase B. "The budget is fixed, so red tiles appear: eligible students who got ₹0." Point at the budget bar and the invariants flipping to FAIL. |
| 0:50–1:10 | Click a red tile → drill-down | "STU-0xx was refused at this timestamp because the budget had run out, and here are the 12 students who were paid twice with that money." |
| 1:10–1:40 | Back to overview → **Run protected processor** | "Same experiment, same replay fingerprint. The protected processor claims the business key, debits the budget, writes the payment and records the delivery in one DynamoDB transaction." Grid goes all green; 12 duplicates suppressed; invariants PASS. |
| 1:40–2:05 | **Compare** | "Fingerprints match, so this is the identical workload. 12 paid twice and 12 paid nothing, versus 100 paid exactly once." |
| 2:05–2:30 | **AWS evidence** drawer, then **Integrity receipt** | "This is the Step Functions execution, per-state timings, the queue and the run's JSON log lines, read live. The receipt is in S3; its SHA-256 is re-computed by the API and again in this browser." |
| 2:30–2:55 | README architecture diagram or the code of `protected.py` | "Why one transaction: a crash can never leave a key claimed but unpaid. Why two phases: SQS doesn't preserve order, so we fix how many students a bad processor starves. All data is synthetic; a PASS means one business effect per entitlement under this replay, nothing more." |
