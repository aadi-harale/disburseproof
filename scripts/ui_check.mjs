#!/usr/bin/env node
/**
 * Browser checks and demo screenshots for the deployed site.
 *
 * Every expected value is read from the API first, then compared with what the page
 * shows, so this proves the UI renders backend data rather than asserting constants.
 * Nothing here writes to AWS: it only reads the public API and drives a browser.
 *
 * Usage:
 *   node scripts/ui_check.mjs                        # checks + screenshots + mobile
 *   node scripts/ui_check.mjs --mode check           # assertions only (CI-friendly)
 *   node scripts/ui_check.mjs --mode shots           # screenshots only
 *   node scripts/ui_check.mjs --mode mobile          # 390 px overflow check
 *   node scripts/ui_check.mjs --site http://localhost:5173 --out /tmp/shots
 *
 * Exit code 0 when every check passes, 1 otherwise.
 *
 * Requires a Chromium-family browser already on the machine (Edge or Chrome); no
 * browser is downloaded. Install the driver once:
 *   npm install --prefix scripts
 */

import { mkdir } from "node:fs/promises";
import { argv, exit } from "node:process";

const DEFAULTS = {
  site: "https://main.d194gkph6yfxxv.amplifyapp.com",
  api: "https://5f1ru6pgai.execute-api.ap-south-1.amazonaws.com",
  out: "docs/screenshots",
  mode: "all",
};

function parseArgs(args) {
  const options = { ...DEFAULTS };
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!flag.startsWith("--")) continue;
    const key = flag.slice(2);
    if (!(key in options)) {
      console.error(`Unknown option --${key}. Known: ${Object.keys(options).join(", ")}`);
      exit(2);
    }
    const value = args[index + 1];
    if (value === undefined || value.startsWith("--")) {
      console.error(`--${key} needs a value`);
      exit(2);
    }
    options[key] = value;
    index += 1;
  }
  if (!["all", "check", "shots", "mobile"].includes(options.mode)) {
    console.error(`--mode must be one of: all, check, shots, mobile`);
    exit(2);
  }
  options.site = options.site.replace(/\/+$/, "");
  options.api = options.api.replace(/\/+$/, "");
  return options;
}

const options = parseArgs(argv.slice(2));

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error(
    "playwright-core is not installed. Run: npm install --prefix scripts\n" +
      "It drives the Edge or Chrome already on this machine and downloads no browser.",
  );
  exit(2);
}

/* ---- Expected values, read from the API ---------------------------------- */

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});
const count = new Intl.NumberFormat("en-IN");
const money = (paise) => inr.format(paise / 100);

async function getJson(path) {
  const response = await fetch(options.api + path);
  if (!response.ok) throw new Error(`GET ${path} returned HTTP ${response.status}`);
  return response.json();
}

/** The pair the home page shows: the latest completed, evaluated runs of the demo test. */
async function goldenPair() {
  const overview = await getJson("/overview");
  const experiment = overview.demo.experiment;
  if (!experiment) throw new Error("The demo experiment is missing from /overview");
  const runs = (await getJson("/runs")).items.filter(
    (run) => run.experiment_id === experiment.experiment_id && run.status === "COMPLETED" && run.verdict,
  );
  const pick = (processor) => runs.find((run) => run.processor === processor) ?? null;
  const unprotected = pick("vulnerable");
  const protectedRun = pick("protected");
  if (!unprotected || !protectedRun) {
    throw new Error("No completed unprotected/protected pair of the demo test exists yet");
  }
  return { experiment, region: overview.region, unprotected, protected: protectedRun };
}

/* ---- Browser plumbing ----------------------------------------------------- */

async function launch() {
  const problems = [];
  for (const channel of ["msedge", "chrome", "chromium"]) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch (error) {
      problems.push(`${channel}: ${String(error).split("\n")[0]}`);
    }
  }
  throw new Error(`No Chromium-family browser could be launched.\n  ${problems.join("\n  ")}`);
}

const results = [];
const check = (name, passed, detail = "") => {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
};
const includes = (name, haystack, needle) =>
  check(name, (haystack ?? "").includes(needle), `expected “${needle}”`);

const text = (page, selector) => page.locator(selector).first().innerText();
const squash = (value) => (value ?? "").replace(/\s+/g, " ").trim();

/** Plays a section's replay to its end without waiting out the pace. */
async function skipReplay(page, section) {
  const skip = page.locator(`#${section}`).getByRole("button", { name: "Skip to result" });
  if (await skip.count()) await skip.first().click();
}

async function openStory(page) {
  await page.goto(options.site + "/", { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: /Can .* students each get paid/ }).waitFor();
}

/* ---- The checks ----------------------------------------------------------- */

async function runChecks(page, expected) {
  const { experiment, region, unprotected, protected: protectedRun } = expected;

  await openStory(page);
  const hero = squash(await text(page, "#hero-question, h1"));
  includes("Hero asks about the batch's students", hero, count.format(experiment.logical_events));
  includes("Hero names the repeat count", hero, count.format(experiment.duplicate_count));

  // 02 Break: the unprotected run's own numbers.
  await page.getByRole("button", { name: "See what goes wrong" }).click();
  await page.waitForTimeout(1200);
  await skipReplay(page, "break");
  const fail = page.locator('#break section[aria-label="Payment integrity failed"]');
  await fail.waitFor({ timeout: 30_000 });
  const climax = squash(await fail.innerText());
  const s = unprotected.summary;
  includes("Break: students paid twice", climax, `${count.format(s.double_paid)} paid twice`);
  includes("Break: students left with nothing", climax, `${count.format(s.unpaid)} got ₹0`);
  includes("Break: misallocated amount", climax, money(s.misallocated_paise));
  includes(
    "Break: paid correctly",
    climax,
    `${count.format(s.paid_once)}/${count.format(s.eligible_entitlements)}`,
  );

  const leak = squash(
    (await page.locator("#break p").allInnerTexts()).find((line) => line.includes("Repeat payments")),
  );
  includes("Break: leak line shows the leaked amount", leak, `−${money(s.misallocated_paise)}`);
  includes("Break: leak line counts the students", leak, `${count.format(s.double_paid)} student`);

  // The verification pill, against the run record. Its fields live in the climax text.
  includes("Break pill: replay fingerprint", climax, unprotected.fingerprint.slice(0, 10));
  if (unprotected.receipt_sha256) {
    includes("Break pill: result digest", climax, unprotected.receipt_sha256.slice(0, 10));
  }
  includes("Break pill: region", climax, region);
  const consoleHref = await page
    .locator('#break a:has-text("Step Functions execution")')
    .first()
    .getAttribute("href");
  check(
    "Break pill: console link points at this run's execution",
    Boolean(consoleHref?.includes(unprotected.run_id)),
    consoleHref ? consoleHref.slice(-60) : "missing",
  );

  // 04 Prove: the protected run's own numbers.
  await page.getByRole("button", { name: "Replay the same test, protected" }).click();
  await page.waitForTimeout(1200);
  await skipReplay(page, "prove");
  const pass = page.locator('#prove section[aria-label="Integrity verified"]');
  await pass.waitFor({ timeout: 30_000 });
  const verified = squash(await pass.innerText());
  const p = protectedRun.summary;
  includes(
    "Prove: students paid",
    verified,
    `${count.format(p.paid_once)}/${count.format(p.eligible_entitlements)}`,
  );
  includes("Prove: repeats refused", verified, `${count.format(p.duplicates_suppressed)} repeats refused`);
  const refused = squash(
    (await page.locator("#prove p").allInnerTexts()).find((line) => line.includes("Repeats refused:")),
  );
  includes("Prove: refused line", refused, `${count.format(p.duplicates_suppressed)}`);
  includes("Prove: nothing leaked", refused, `${money(0)} leaked`);

  // The toggle shows each run's final state, and only those two states.
  const toggle = page.locator('#prove [role="group"][aria-label^="Which processor"]');
  if (await toggle.count()) {
    const legend = async () =>
      squash((await page.locator("#prove ul[aria-label=Legend]").first().allInnerTexts()).join(" "));
    const seen = new Set([await legend()]);
    for (let round = 0; round < 3; round += 1) {
      await toggle.getByRole("button", { name: /Unprotected/ }).click();
      await page.waitForTimeout(350);
      seen.add("UN " + (await legend()));
      await toggle.getByRole("button", { name: /Protected/ }).click();
      await page.waitForTimeout(350);
      seen.add("PR " + (await legend()));
    }
    const states = [...seen];
    check("Toggle is stable over three round trips", states.length === 3, `${states.length} distinct states`);
    const unprotectedState = states.find((state) => state.startsWith("UN")) ?? "";
    includes("Toggle: unprotected paid twice", unprotectedState, `Paid twice ${count.format(s.double_paid)}`);
    includes("Toggle: unprotected unpaid", unprotectedState, `Unpaid ${count.format(s.unpaid)}`);
  } else {
    check("Toggle is present when a matching pair exists", false, "toggle missing");
  }

  // Compare: both runs, from the same backend numbers.
  await page.goto(`${options.site}/compare?a=${unprotected.run_id}&b=${protectedRun.run_id}`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: "Same test. Different outcome." }).waitFor();
  const table = squash(await text(page, "table"));
  includes("Compare: deliveries row", table, count.format(s.deliveries));
  includes("Compare: misallocated row", table, money(s.misallocated_paise));
  includes("Compare: fingerprints match banner", squash(await text(page, "body")), "Match");

  // Receipt: the human summary matches the evaluation.
  await page.goto(`${options.site}/runs/${unprotected.run_id}/receipt`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Integrity receipt" }).waitFor();
  const receipt = squash(await text(page, "article section"));
  includes(
    "Receipt: students paid",
    receipt,
    `${count.format(s.eligible_entitlements - s.unpaid)}/${count.format(s.eligible_entitlements)}`,
  );
  includes("Receipt: misallocated", receipt, money(s.misallocated_paise));
}

/** A hidden tab gets no animation frames: the replay must still follow the wall clock. */
async function checkReplayWithoutFrames(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.requestAnimationFrame = () => 0;
    window.cancelAnimationFrame = () => {};
  });
  await openStory(page);
  await page.getByRole("button", { name: "See what goes wrong" }).click();
  await page.waitForTimeout(24_000);
  const arrived = squash((await page.locator("#break dd").allInnerTexts())[0]);
  const climaxShown = await page.locator('#break section[aria-label="Payment integrity failed"]').count();
  check(
    "Replay advances with animation frames suppressed (hidden tab)",
    climaxShown > 0,
    `counter ${arrived}`,
  );
  await context.close();
}

/* ---- Screenshots ---------------------------------------------------------- */

async function takeShots(page) {
  await mkdir(options.out, { recursive: true });
  const shot = async (name) => {
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${options.out}/${name}.png` });
    console.log(`  saved ${name}.png`);
  };
  const scrollTo = (selector, offset = 110) =>
    page.evaluate(
      ([sel, off]) => {
        const element = document.querySelector(sel);
        if (!element) throw new Error("missing " + sel);
        window.scrollTo({ top: element.getBoundingClientRect().top + window.scrollY - off, behavior: "instant" });
      },
      [selector, offset],
    );

  await openStory(page);
  await shot("01-hero");
  await page.getByRole("button", { name: "See what goes wrong" }).click();
  await page.waitForTimeout(1200);
  await skipReplay(page, "break");
  await page.locator('#break section[aria-label="Payment integrity failed"]').waitFor();
  await scrollTo('#break section[aria-label="Payment integrity failed"]');
  await shot("02-fail-climax");
  await scrollTo('#break section[aria-label="Why it failed"]');
  await shot("03-why-it-failed");
  await scrollTo("#protect", 100);
  await shot("04-protect-same-test");

  await page.getByRole("button", { name: "Replay the same test, protected" }).click();
  await page.waitForTimeout(1200);
  await skipReplay(page, "prove");
  await page.locator('#prove section[aria-label="Integrity verified"]').waitFor();
  await scrollTo('#prove section[aria-label="Integrity verified"]');
  await shot("05-verified-climax");

  const toggle = page.locator('#prove [role="group"][aria-label^="Which processor"]');
  if (await toggle.count()) {
    await scrollTo('#prove [role="group"][aria-label^="Which processor"]', 130);
    await shot("12-toggle-protected");
    await toggle.getByRole("button", { name: /Unprotected/ }).click();
    await page.waitForTimeout(600);
    await scrollTo('#prove [role="group"][aria-label^="Which processor"]', 130);
    await shot("13-toggle-unprotected");
    await toggle.getByRole("button", { name: /Protected/ }).click();
  }
}

async function takePageShots(page, expected) {
  const shot = async (name) => {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${options.out}/${name}.png` });
    console.log(`  saved ${name}.png`);
  };
  const { unprotected, protected: protectedRun } = expected;
  await page.goto(`${options.site}/compare?a=${unprotected.run_id}&b=${protectedRun.run_id}`, {
    waitUntil: "networkidle",
  });
  await page.getByRole("heading", { name: /Same test|Compare two runs/ }).waitFor();
  await shot("06-compare");
  await page.goto(`${options.site}/runs/${protectedRun.run_id}/receipt`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Integrity receipt" }).waitFor();
  await shot("07-receipt");
  await page.goto(`${options.site}/evidence?run=${protectedRun.run_id}`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Service path" }).waitFor();
  await shot("08-aws-evidence");

  await page.goto(`${options.site}/new`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "New test" }).waitFor();
  await shot("09-new-test");
  await page.goto(`${options.site}/runs`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "My runs" }).waitFor();
  await shot("10-my-runs");

  const student = unprotected.summary.double_paid_beneficiary_ids[0];
  if (student) {
    await page.goto(`${options.site}/runs/${unprotected.run_id}/students/${student}`, {
      waitUntil: "networkidle",
    });
    await page.locator("[role=dialog]").waitFor();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${options.out}/14-student-forensics.png` });
    console.log("  saved 14-student-forensics.png");
  }
}

/* ---- Small screens -------------------------------------------------------- */

async function checkMobile(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: "dark",
    isMobile: true,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  for (const path of ["/", "/runs", "/new", "/compare", "/docs"]) {
    await page.goto(options.site + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`No horizontal scroll at 390 px on ${path}`, overflow <= 0, `${overflow} px`);
  }
  if (options.mode !== "check") {
    await page.goto(options.site + "/", { waitUntil: "networkidle" });
    await page.waitForTimeout(900);
    await mkdir(options.out, { recursive: true });
    await page.screenshot({ path: `${options.out}/11-hero-390.png` });
    console.log("  saved 11-hero-390.png");
  }
  await context.close();
}

/* ---- Main ----------------------------------------------------------------- */

const browser = await launch();
const consoleErrors = [];
let expected;
try {
  expected = await goldenPair();
  console.log(
    `Site ${options.site}\nRecorded pair ${expected.unprotected.run_id} (${expected.unprotected.verdict}) / ` +
      `${expected.protected.run_id} (${expected.protected.verdict})\n`,
  );

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (error) => consoleErrors.push(String(error)));
  page.on("console", (message) => message.type() === "error" && consoleErrors.push(message.text()));

  if (options.mode === "all" || options.mode === "check") {
    await runChecks(page, expected);
    await checkReplayWithoutFrames(browser);
  }
  if (options.mode === "all" || options.mode === "shots") {
    await takeShots(page);
    await takePageShots(page, expected);
  }
  if (options.mode === "all" || options.mode === "mobile") {
    await checkMobile(browser);
  }
  if (options.mode !== "shots") {
    check("No console errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  results.push({ name: "Run completed", passed: false, detail: "threw" });
} finally {
  await browser.close();
}

const failed = results.filter((result) => !result.passed);
if (results.length > 0) {
  console.log(
    `\n${failed.length === 0 ? "UI CHECK PASSED" : `UI CHECK FAILED (${failed.length} of ${results.length})`}`,
  );
}
exit(failed.length === 0 ? 0 : 1);
