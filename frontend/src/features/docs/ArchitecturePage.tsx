import { Card, CardBody } from "../../components/ui/Card";
import { PageHeader } from "../../components/ui/PageHeader";
import { useDocumentTitle } from "../../lib/hooks";

const SERVICES: { service: string; role: string; why: string }[] = [
  {
    service: "Amplify Hosting",
    role: "Serves this site",
    why: "Static hosting with the security headers (CSP, HSTS) applied at the edge.",
  },
  {
    service: "API Gateway (HTTP API)",
    role: "Public front door",
    why: "One throttled, CORS-restricted entry point for the browser; no servers to patch.",
  },
  {
    service: "Step Functions",
    role: "Orchestrates each run",
    why: "Sends the instructions, waits for the queue to drain, then evaluates and writes the receipt — every step visible and retried on failure.",
  },
  {
    service: "SQS + dead-letter queue",
    role: "Carries payment instructions",
    why: "At-least-once delivery is exactly what creates repeats; the dead-letter queue catches anything that keeps failing.",
  },
  {
    service: "Lambda worker",
    role: "Processes instructions",
    why: "Scales with the queue (batches of 10, up to 5 at once) and costs nothing when idle.",
  },
  {
    service: "DynamoDB",
    role: "The ledger",
    why: "One TransactWriteItems per payment saves the “paid” record and the payment together, so a repeat can’t pay twice.",
  },
  {
    service: "Lambda evaluator",
    role: "Checks every student",
    why: "Recomputes the three checks from the stored rows after all instructions are handled; the UI never decides a verdict.",
  },
  {
    service: "S3",
    role: "Stores receipts",
    why: "A versioned, HTTPS-only bucket; the receipt’s SHA-256 is recorded on the run and rechecked on read.",
  },
  {
    service: "CloudWatch",
    role: "Logs and metrics",
    why: "Structured logs from every function, shown as evidence next to each run.",
  },
];

export function ArchitecturePage() {
  useDocumentTitle("Architecture");
  return (
    <>
      <PageHeader
        eyebrow="Engineering · Architecture"
        title="What runs where, and why"
        description="Every service in the path of a run, with one reason it is there."
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,340px)]">
        <Card>
          <ol className="divide-y divide-line">
            {SERVICES.map((item, index) => (
              <li
                key={item.service}
                className="grid gap-1 px-5 py-3.5 sm:grid-cols-[28px_220px_minmax(0,1fr)] sm:gap-4"
              >
                <span className="figures text-[13px] text-faint">{String(index + 1).padStart(2, "0")}</span>
                <div>
                  <div className="text-[15px] font-semibold">{item.service}</div>
                  <div className="text-[13px] text-muted">{item.role}</div>
                </div>
                <p className="text-[14.5px]">{item.why}</p>
              </li>
            ))}
          </ol>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardBody className="space-y-2">
              <h2 className="text-[16px] font-semibold">Why serverless?</h2>
              <p className="text-[14.5px] text-muted">
                Tests are bursty and short: a run lasts about 5–15 seconds, then nothing happens until the
                next one. Serverless means paying for execution, not idle servers, and the queue, workflow and
                database scale up for a burst without capacity planning.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-2">
              <h2 className="text-[16px] font-semibold">What was learned</h2>
              <p className="text-[14.5px] text-muted">
                Reliable message delivery and correct business behaviour are different problems; retries are
                only safe when correctness lives at the business-operation boundary.
              </p>
            </CardBody>
          </Card>
          <Card>
            <CardBody className="space-y-1.5 text-[14px] text-muted">
              <h2 className="text-[16px] font-semibold text-ink">Guard rails on the public demo</h2>
              <p>
                API throttling, hourly limits on new runs and batches, a cap on runs at a time, strict input
                checks and no secrets in the backend (IAM roles only).
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
