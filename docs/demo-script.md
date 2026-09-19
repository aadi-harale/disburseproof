# Demo video script (2:52)

## Setup

- Record the live site at **1440×900**, dark theme, browser zoom 100%: https://main.d194gkph6yfxxv.amplifyapp.com
- Replays use the **recorded** golden pair at **demo pace**. Demo pace plays the run's real delivery rows in their real order, evenly spaced over about 20 seconds. Nothing depends on a live run succeeding while you record.
- Before recording, open `/` once so the recorded pair is cached. Open the Step Functions console in a second tab, signed in, on the protected run's execution. The "Open in AWS console" link in the evidence panel goes straight there.

**Measured timings.** On 19 Sep 2026, eight golden runs on AWS took **5.2–12.3 s** from POST `/runs` to the receipt being written. The deliveries themselves span about 4–6 s. At 1× real time a replay therefore lasts about 5 s; demo pace stretches the same rows to about 20 s. The two replay slots below (0:10–0:35 and 1:20–1:45) each allow 25 s, so both fit with a few seconds to spare.

## Shot list

| Time | Screen and action | Narration |
|---|---|---|
| 0:00 | **Home hero.** Hold still. | "Can 100 students each get paid exactly once when 12 payment instructions are sent twice? DisburseProof runs a synthetic scholarship payout on AWS and checks every student's result." |
| 0:10 | Click **See what goes wrong**. The page scrolls to **02 Break** and the recorded unprotected run replays. | "100 students, ₹10,000 each: a ₹10,00,000 budget, exactly enough to pay everyone once. Retries are normal, so 12 instructions arrive twice: 112 arrivals. Watch the unprotected processor. Amber tiles are students paid twice. The budget bar drains faster than it should…" |
| 0:28 | Replay reaches the last instructions. Red ₹0 tiles appear and the feed shows "Budget used up". | "…and now eligible students are getting nothing." |
| 0:35 | The **FAIL climax** scrolls into view. | "Payment integrity failed. 12 students paid twice, 12 got ₹0, ₹1,20,000 misallocated, 76 of 100 paid correctly. The budget was never overspent. The damage was who got the money." |
| 0:45 | **Why it failed** cards. | "Two real students from this run. This one was paid by the first instruction and paid again by the repeat: same entitlement, two payments. This one's instruction arrived after the budget ran out. In total, the 12 repeat payments used ₹1,20,000, exactly the money the last 12 eligible students needed." |
| 1:00 | Click **03 Protect** in the rail. | "The fix is one idea: give every entitlement one identity. Scheme, student, year and installment together make the key. The 'paid' record and the payment are saved together in one DynamoDB transaction, so a repeat, even a simultaneous one, can't create a second payment." |
| 1:15 | Point at the **Same-test proof** card. | "Same students. Same repeats. Same test. The fingerprints match." |
| 1:20 | Click **Replay the same test, protected**. **04 Prove** replays the protected run. | "Same test, protected processor. Each repeat arrives, finds its identity already recorded, and is refused before it reaches the ledger. Watch the refused counter." |
| 1:45 | **Integrity verified** climax. Hold for a beat. | "Integrity verified. 100 of 100 students paid, none twice, none unpaid, 12 repeats refused, ₹0 misallocated. Every eligible student received exactly one synthetic payment under the tested workload." |
| 2:00 | Click **Compare side by side**. | "Same test, different outcome. The only thing that changed is how the processor handles a payment's identity." |
| 2:15 | Back, then **Open integrity receipt**. | "Every run writes a receipt to S3. The page recomputes its SHA-256 checksum in the browser, so you can see the file hasn't changed since it was written." |
| 2:25 | Back, then **See AWS evidence**, then switch to the Step Functions console tab. | "And this all really ran on AWS: Step Functions orchestrated it, SQS delivered 112 instructions, Lambda processed them, DynamoDB recorded 100 payments and 12 refusals, and the evaluator checked every student." |
| 2:40 | **Engineering → Architecture**. | "Serverless fits: tests are short and bursty, so you pay for execution, not idle servers. The lesson: reliable message delivery and correct business behaviour are different problems. Retries are only safe when correctness lives at the business-operation boundary." |
| 2:52 | Back to the hero. | "DisburseProof: multiple deliveries, one verified benefit." |

## Wording rules

- Describe the cause **in aggregate**: "the 12 repeat payments used ₹1,20,000, exactly the money the last 12 eligible students needed". Never say one particular repeat took one particular student's money. The backend records no per-student link of that kind.
- Say "every eligible student received exactly one synthetic payment under the tested workload". Never say "exactly-once delivery".
- Do not claim that PFMS, NSP, MahaDBT or any bank uses this design. Do not call SHA-256 "tamper-proof".

## If something goes wrong while recording

- **A replay looks wrong:** click **Replay** to restart it at the same pace, or **Skip to result** to jump to the verdict. The result is the backend's evaluation either way.
- **"Run it live on AWS" says live runs are busy:** stay on the recorded run. It is real data from an earlier run of the identical test.
- **The page is slow on first load:** reload once. Lambda cold starts add about a second.
