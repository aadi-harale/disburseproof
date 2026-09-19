# Where each judging criterion shows up

Times refer to [demo-script.md](demo-script.md). Every number on screen comes from the deployed backend. None are typed into the UI.

| Criterion | Where to look | What it shows |
|---|---|---|
| **Idea and impact** | 0:00 hero; 0:35 FAIL climax; 0:45 "Why it failed" | The problem is concrete: 100 students, a fixed budget, 12 repeats. The harm is concrete too: 12 students paid twice and 12 eligible students got ₹0, with ₹1,20,000 going to the wrong place. Retries are normal in payment systems, and the damage from them is invisible until reconciliation. |
| **Built on AWS** | 2:25 AWS evidence and the Step Functions console; Engineering → Architecture | Step Functions, SQS with a dead-letter queue, Lambda, DynamoDB transactions, S3, CloudWatch, API Gateway and Amplify, all deployed with SAM in ap-south-1. The evidence panel reads the execution, queue depths and log lines live for the run on screen. |
| **Learning** | 1:00 Protect; 2:40 closing line; README "What I learned" | Delivery and correctness are different problems, so the key has to be the entitlement, not the message. Making "paid" and the payment one transaction removes the crash windows. The two-phase injection is what makes the result repeatable. |
| **Execution** | 1:15 same-test proof; 2:00 Compare; My runs; New test | Both runs share one fingerprint. The UI replays real delivery rows instead of animating fake ones. Any user can run their own batch (CSV or generated) and retry scenario. The rows behind every result can be exported, and every run has a shareable link. CI runs tests, linting, type checks, security scans and IaC checks. |
| **Demo video** | The whole of demo-script.md, 2:52 | One story, told in order: define → break → why → protect → prove → compare → receipt → AWS. It uses recorded replays at demo pace, so the video never depends on a live run. |
| **Ship It: architecture and cost** | Architecture page ("Why serverless?"); README "Cost" and "Security and threat model" | Nothing is provisioned: no servers, and on-demand tables. Idle cost is near zero, and one run costs a fraction of a US cent. The public API has cost guards: throttling, hourly limits, and a cap on concurrent runs. The backend holds no secrets and uses IAM roles only. |
| **Best UI** | 0:10–0:35 Break replay; 1:45 VERIFIED climax; the 390 px layout | The grid, budget bar, feed and flow strip all explain the same state change. Each tile shows its status by colour, glyph and label together. The grid works with the keyboard and has a list view. Labels are plain first, with the technical term beside them. The layout has no horizontal scroll at 390 px. |

## Claims we deliberately do not make

- Not "exactly-once delivery". The claim is only that every eligible student received exactly one synthetic payment under the tested workload.
- No claim about how PFMS, NSP, MahaDBT or any bank is built.
- The receipt checksum shows the file has not changed since it was written. It is not a signature and not tamper-proof.
- DisburseProof tests its own built-in processors. It does not test your own payment system; that is on the roadmap, not built.
