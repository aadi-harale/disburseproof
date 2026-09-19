import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "react-router";

import { Button } from "../../components/ui/Button";
import { cx } from "../../components/ui/cx";
import { Icon } from "../../components/ui/Icon";
import { PageHeader } from "../../components/ui/PageHeader";
import { downloadText } from "../../lib/csv";
import { useDocumentTitle } from "../../lib/hooks";
import { CHECK } from "../../lib/labels";
import { STUDENT_STATES } from "../runs/studentStates";
import { CSV_COLUMNS, MAX_ROWS, TEMPLATE_CSV } from "../newtest/csvHelp";

const SECTIONS = [
  ["about", "What it does"],
  ["who", "Who it's for"],
  ["first-test", "Your first test"],
  ["csv", "CSV format"],
  ["results", "Reading a result"],
  ["receipt", "The receipt"],
  ["glossary", "Glossary"],
  ["limits", "Limits"],
  ["faq", "FAQ"],
  ["roadmap", "Roadmap"],
] as const;

/** Short, plain documentation inside the app. Each section has an anchor for "?" links. */
export function DocsPage() {
  useDocumentTitle("Docs");
  const location = useLocation();
  useEffect(() => {
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [location.hash]);

  return (
    <>
      <PageHeader
        title="Docs"
        description="How to use DisburseProof, what its results mean, and what it does not do."
      />
      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <ol className="sticky top-20 space-y-1 text-[14px]">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  className="block rounded-md px-2 py-1 text-muted hover:bg-surface-2 hover:text-ink"
                >
                  {label}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <article className="max-w-3xl space-y-10 text-[15.5px] leading-relaxed">
          <Doc id="about" title="What DisburseProof does">
            <p>
              DisburseProof runs a synthetic scholarship payout on AWS and checks every student&apos;s result.
              It sends each student&apos;s payment instruction through a real queue, some of them twice — the
              way retries do in real payment systems — and then checks three things: no student was paid
              twice, every eligible student was paid, and the budget was never overspent.
            </p>
            <p>
              It runs the same test through two built-in processors: an <strong>unprotected</strong> one,
              which treats each message as new, and a <strong>protected</strong> one, which gives every
              entitlement one identity and records “paid” and the payment together in one database
              transaction.
            </p>
          </Doc>

          <Doc id="who" title="Who it's for">
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Backend and platform engineers</strong> — see how a disbursement pipeline behaves
                under retries, compare an unsafe design with a safe one, and show the evidence to reviewers.
              </li>
              <li>
                <strong>Programme technology and audit teams</strong> — model “what if this many instructions
                are repeated in a batch like ours?” and get a plain-language result and a receipt to file.
              </li>
              <li>
                <strong>Students and learners</strong> — watch idempotency and at-least-once delivery happen
                for real on AWS.
              </li>
            </ul>
            <p className="rounded-xl border border-line bg-surface px-4 py-3 text-[14.5px]">
              <strong>Scope:</strong> DisburseProof tests its built-in processors against your batch and retry
              scenario. It does not connect to, or test, your own payment system.
            </p>
          </Doc>

          <Doc id="first-test" title="Run your first test">
            <ol className="list-decimal space-y-2 pl-5">
              <li>
                <strong>Choose students.</strong> Open{" "}
                <Link to="/new" className="text-accent-text hover:underline">
                  New test
                </Link>{" "}
                and use the demo batch, generate students, or upload a CSV.
              </li>
              <li>
                <strong>Choose the retry scenario.</strong> Pick how many payment instructions are sent twice
                (a preset, the slider or a number) and a seed. The page shows the arrivals, e.g. “Of 250
                instructions, 30 will be sent twice → 280 arrivals”.
              </li>
              <li>
                <strong>Run.</strong> “Run both” starts the unprotected and protected processors on the same
                test and opens them side by side. A run takes about 5–15 seconds; you can leave and find it
                later in{" "}
                <Link to="/runs" className="text-accent-text hover:underline">
                  My runs
                </Link>
                .
              </li>
            </ol>
          </Doc>

          <Doc id="csv" title="CSV format">
            <p>
              One row per student and installment, with this header:{" "}
              <code className="figures rounded bg-surface-2 px-1.5 py-0.5 text-[13.5px]">
                {CSV_COLUMNS.join(",")}
              </code>
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <code className="figures">beneficiary_id</code>: 1–32 capital letters, digits or “-” (e.g.
                STU-042).
              </li>
              <li>
                <code className="figures">display_name</code>: letters, spaces, “.”, “&apos;” and “-”; starts
                with a letter; at most 60 characters.
              </li>
              <li>
                <code className="figures">amount_paise</code>: a whole number of paise (₹10,000 = 1000000).
              </li>
              <li>
                <code className="figures">installment</code>: 1–99. Each student + installment may appear
                once.
              </li>
              <li>Up to {MAX_ROWS} rows. The budget is the sum of all amounts.</li>
            </ul>
            <Button onClick={() => downloadText("disburseproof-template.csv", TEMPLATE_CSV + "\r\n")}>
              <Icon name="download" /> Download the template
            </Button>
            <p className="text-[14px] text-muted">
              Every problem is listed by line, in plain words, before anything is saved. Fix it in the text
              box and the check runs again.
            </p>
          </Doc>

          <Doc id="results" title="Reading a result">
            <ul className="space-y-2">
              {(["paid_once", "paid_twice", "unpaid"] as const).map((state) => (
                <li key={state} className="flex items-start gap-3">
                  <span
                    className={cx(
                      "figures grid size-7 shrink-0 place-items-center rounded-md text-[12px] font-semibold",
                      STUDENT_STATES[state].tile,
                    )}
                    aria-hidden
                  >
                    {STUDENT_STATES[state].glyph}
                  </span>
                  <span>
                    <strong>{STUDENT_STATES[state].name}</strong> —{" "}
                    {state === "paid_once"
                      ? "the student received exactly what they were owed."
                      : state === "paid_twice"
                        ? "a repeat instruction paid the same entitlement again."
                        : "the student was eligible but the budget ran out before their instruction arrived."}
                  </span>
                </li>
              ))}
            </ul>
            <p>The three checks, decided by the backend after every instruction has been handled:</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>{CHECK.one_payment_per_entitlement!.primary}</strong> (
                {CHECK.one_payment_per_entitlement!.technical}) — at most one payment per entitlement.
              </li>
              <li>
                <strong>{CHECK.every_eligible_paid!.primary}</strong> ({CHECK.every_eligible_paid!.technical})
                — every eligible student received a payment.
              </li>
              <li>
                <strong>{CHECK.budget_guard!.primary}</strong> ({CHECK.budget_guard!.technical}) — total paid
                never exceeded the budget.
              </li>
            </ul>
            <p>
              A run passes only if all three pass. When the amounts differ between students, the number of
              students left unpaid need not equal the number of repeats — the result page always uses the
              run&apos;s own numbers.
            </p>
          </Doc>

          <Doc id="receipt" title="The receipt">
            <p>
              Every completed run writes a JSON receipt to S3: the counts, the three checks, the affected
              students, the test&apos;s fingerprint and the Step Functions execution. The receipt page
              recomputes its SHA-256 checksum in your browser and compares it with the one recorded when it
              was written. A match shows the file has not changed since; it is not a signature and not
              tamper-proof. Use “Download JSON” to file it, or “Print / Save as PDF”.
            </p>
          </Doc>

          <Doc id="glossary" title="Glossary">
            <dl className="divide-y divide-line rounded-xl border border-line">
              {[
                ["Entitlement", "entitlement", "What one student is owed for one installment."],
                [
                  "Payment instruction",
                  "delivery",
                  "One message asking the processor to pay an entitlement.",
                ],
                ["Repeat", "duplicate delivery", "An extra copy of an instruction, as sent by a retry."],
                ["Payment", "ledger effect", "Money actually recorded as paid."],
                [
                  "Repeat refused",
                  "DUPLICATE_SUPPRESSED",
                  "The processor saw the entitlement was already paid.",
                ],
                [
                  "Not paid — budget ran out",
                  "BUDGET_EXHAUSTED",
                  "Refused because too little budget remained.",
                ],
                [
                  "Same-test proof",
                  "replay fingerprint",
                  "SHA-256 of the test definition; equal means the same test.",
                ],
                [
                  "Identity",
                  "idempotency key",
                  "Scheme + student + year + installment: one per entitlement.",
                ],
              ].map(([plain, technical, meaning]) => (
                <div key={plain} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[220px_minmax(0,1fr)]">
                  <dt>
                    <span className="font-semibold">{plain}</span>{" "}
                    <span className="figures block text-[12px] text-faint">{technical}</span>
                  </dt>
                  <dd className="text-muted">{meaning}</dd>
                </div>
              ))}
            </dl>
          </Doc>

          <Doc id="limits" title="Limits">
            <ul className="list-disc space-y-1 pl-5">
              <li>Up to {MAX_ROWS} students per batch; up to half of them repeated per test.</li>
              <li>
                This is a public demo, so live runs are limited: a few at a time and a fixed number per hour
                for everyone together. When a limit is hit, the page says so and offers the recorded run
                instead.
              </li>
              <li>Synthetic data only. No real money moves and no bank or government system is contacted.</li>
            </ul>
          </Doc>

          <Doc id="faq" title="FAQ">
            <Faq q="Is this real money?">
              No. Every student, amount and payment is synthetic and lives in this app&apos;s own DynamoDB
              tables.
            </Faq>
            <Faq q="Does this test my own system?">
              No. It tests the two built-in processors against your batch and retry scenario. Testing your own
              processor is on the roadmap, not built.
            </Faq>
            <Faq q="Is the protected processor “exactly-once delivery”?">
              No. Instructions are still delivered at least once, and repeats still arrive. What holds is the
              business result: every eligible student received exactly one synthetic payment under the tested
              workload.
            </Faq>
            <Faq q="Do real payment systems use this design?">
              DisburseProof makes no claim about how any government, scheme or bank system is built. It
              demonstrates a general technique on synthetic data.
            </Faq>
            <Faq q="Why did my live run not start?">
              Live runs are shared and limited on this public demo. The message tells you when to try again;
              the recorded runs are always available.
            </Faq>
          </Doc>

          <Doc id="roadmap" title="Roadmap">
            <ul className="space-y-2">
              <li className="rounded-xl border border-dashed border-line-strong px-4 py-3">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] font-semibold text-muted">
                  Not yet
                </span>{" "}
                <strong>Test your own processor</strong> — point DisburseProof at your own payment endpoint.
                Not built; today only the built-in processors are tested.
              </li>
            </ul>
          </Doc>
        </article>
      </div>
    </>
  );
}

function Doc({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3">
      <h2 id={`${id}-title`} className="text-[22px] font-semibold tracking-[-0.01em]">
        <a href={`#${id}`} className="hover:underline">
          {title}
        </a>
      </h2>
      {children}
    </section>
  );
}

function Faq({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="rounded-xl border border-line bg-surface px-4 py-3">
      <summary className="cursor-pointer font-semibold">{q}</summary>
      <p className="mt-2 text-muted">{children}</p>
    </details>
  );
}
