# Demo video script — 2:52, click by click, word for word

Every control below is named exactly as it appears on screen. Narration is timed: each line fits its window at a calm ~2.4 words per second, with silence left over the replays. Read it as written and the video lands at 2:52.

## Before you hit record

1. Browser window **1440×900**, zoom **100%**, bookmarks bar hidden, one window, two tabs.
2. **Tab 1:** https://main.d194gkph6yfxxv.amplifyapp.com — open it once and let it load, so the recorded pair is cached. Scroll back to the very top.
3. **Tab 2:** the AWS Step Functions console, signed in, on the protected run's execution (the "Open Step Functions execution" button in the app links to it).
4. Check the home page shows the pair you expect: 02 Break is the unprotected run, 04 Prove the protected one. If either says "No recorded test yet", press **Run it live on AWS** once and wait ~15 s.
5. Turn off notifications. Mute other tabs.
6. Do not touch the mouse during the two replays — they run themselves for about 20 seconds each.

**Timings are measured, not guessed.** Eight golden runs on AWS took 5.2–12.3 s each; the delivery rows span about 4–6 s. "Demo pace" replays those same rows evenly over ~20 s, which is what the two replay beats below are built around.

## The shot list

| # | Time | Do exactly this | Say exactly this |
|---|---|---|---|
| 1 | 0:00 | Hold on the hero. No clicks. | "Can a hundred students each get paid exactly once, when twelve payment instructions are sent twice? DisburseProof runs that payout on AWS and checks every student's result." |
| 2 | 0:12 | Click **See what goes wrong**. The page scrolls to 02 Break and the replay starts. Hands off. | "A hundred students, ten thousand rupees each — a budget that is exactly enough to pay everyone once. Retries are normal, so twelve instructions arrive twice. This is the unprotected processor. Amber means paid twice." |
| 3 | 0:30 | Still hands off. The amber part of the budget bar grows and flashes; red ₹0 tiles appear. | "Every repeat takes money the budget needed. Minus one lakh twenty thousand — and now eligible students are getting nothing." |
| 4 | 0:38 | The FAIL climax scrolls itself into view. | "Payment integrity failed. Twelve paid twice, twelve got zero, one lakh twenty thousand misallocated. The budget never overspent — the damage was who got the money." |
| 5 | 0:50 | Move the cursor along the pill row under the numbers. No clicks. | "Every result carries its own evidence: the test's fingerprint, the receipt digest, and a link to the AWS execution behind it." |
| 6 | 0:58 | Scroll down one notch to the two **Why it failed** cards. | "Here is why. This student was paid, then paid again by the repeat. This one's instruction arrived after the budget ran out. The twelve repeats took exactly what those twelve students needed." |
| 7 | 1:10 | Click **03 Protect** in the rail at the top. | "The fix is one idea: give every entitlement one identity — scheme, student, year, installment. The paid record and the payment are written in a single DynamoDB transaction, so a repeat cannot create a second payment." |
| 8 | 1:24 | Point at the **Same-test proof** card on the right. | "Same students, same repeats, same test — the fingerprints match." |
| 9 | 1:30 | Click **Replay the same test, protected**. The page scrolls to 04 Prove and replays. Hands off. | "Now the protected processor, on that same test. Each repeat arrives, finds the entitlement already paid, and is refused before it reaches the ledger. Nothing leaks." |
| 10 | 1:46 | The **Integrity verified** climax appears. Hold still on it. | "Integrity verified. A hundred of a hundred paid, none twice, none unpaid, twelve repeats refused, zero misallocated. Same test, correct outcome." |
| 11 | 1:58 | Above the grid, click **✕ Unprotected**, wait two seconds, then click **✓ Protected**. | "Same tiles, same positions. This is what the unprotected processor did to these students — and this is what the protected one did." |
| 12 | 2:08 | In 04 Prove, click the tile **STU-021 · Paid once**. The run page opens with the student sheet. | "One student, both runs. In the unprotected run: paid, then paid again by the repeat — twenty thousand rupees. Here the repeat was refused, and they received exactly ten." |
| 13 | 2:20 | Press **Esc**. The sheet closes and the run page shows the same verdict. | "Every run has its own page: the same verdict, the receipt digest, and a link to the execution." |
| 14 | 2:28 | Click **AWS evidence** in the page header. | "The service path, read live from AWS: instructions delivered, processed, recorded, verified." |
| 15 | 2:36 | Switch to tab 2, the Step Functions console. | "And this is that execution in the console — a hundred and twelve instructions, one verified result." |
| 16 | 2:44 | Hold there, or switch back to tab 1. | "Retries are only safe when correctness lives at the business operation. DisburseProof — multiple deliveries, one verified benefit." |

Total narration: 362 words over 172 seconds — 2.1 words per second on average, never above 2.7 in any single beat, with the slack sitting in beats 2, 3 and 9 where the replay carries itself.

## If something goes wrong while recording

- **A replay looks wrong:** click **Replay** to run it again at the same pace, or **Skip to result** to jump to the verdict. Either way the numbers are the backend's evaluation.
- **A replay looks stuck at 0:** it should not be — progress follows the wall clock even in a hidden window — but **Skip to result** gives the same evaluated outcome.
- **"Run it live on AWS" says live runs are busy:** stay on the recorded run. It is real data from an earlier run of the identical test.
- **Want Compare on screen too?** It costs about 12 seconds: from 04 Prove click **Compare side by side**, say "same test, different outcome — only the processor changed", then browser **Back**. Drop beat 14 to make room.
- **The student sheet opens on the wrong student:** press Esc and click a tile whose label reads "Paid twice"; STU-012, 018, 021, 022, 048, 059, 062, 063, 080, 081, 095 and 100 are the repeated ones in the golden test.
- **The page is slow on first load:** reload once. Lambda cold starts add about a second.

## Wording rules

- Describe the cause **in aggregate**: "the twelve repeats took exactly what those twelve students needed". Never say one particular repeat took one particular student's money — the backend records no such link.
- Say "every eligible student received exactly one synthetic payment under the tested workload". Never "exactly-once delivery".
- Say "repeat instruction refused", never "silently discarded": refusals are recorded and counted.
- Say "replay fingerprint" and "result digest". There is no lease anywhere in this design, and SHA-256 here shows sameness — it is not a signature and not "tamper-proof".
- Which students end up with ₹0 varies between unprotected runs, so say "twelve eligible students got ₹0", never "the bottom twelve".
- Do not claim that PFMS, NSP, MahaDBT or any bank uses this design.
