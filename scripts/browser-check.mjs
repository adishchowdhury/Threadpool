import { chromium } from "playwright";
import fs from "fs";

const shotDir = "scripts/.screenshots";
fs.mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => consoleErrors.push(String(err)));
page.on("response", (res) => {
  if (res.status() >= 400) consoleErrors.push(`HTTP ${res.status()} ${res.url()}`);
});

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
await page.waitForSelector("text=Kraven");
await page.screenshot({ path: `${shotDir}/01-loaded.png`, fullPage: true });
console.log("Loaded dashboard. Agent registry visible:", await page.locator("text=Agent Registry").isVisible());

await page.click('button[aria-label="Run task"]');
console.log("Clicked send button");

// Capture the planning/loading state before subtasks exist
await page.waitForTimeout(1500);
await page.screenshot({ path: `${shotDir}/02a-planning.png`, fullPage: true });

// Wait for the workflow canvas itself (not just the activity-feed log line)
// to show the first generated workflow node.
await page
  .getByText(/step 1/i)
  .first()
  .waitFor({ timeout: 20000 })
  .catch(() => console.log("no workflow node appeared in the workflow graph in time"));
await page.screenshot({ path: `${shotDir}/02-running.png`, fullPage: true });

// Wait for completion (Final Report) or failure, up to 60s
try {
  await page.waitForSelector("text=Final Report", { timeout: 120000 });
  console.log("Task completed — Final Report visible");
} catch {
  console.log("Task did not complete within 60s — capturing state anyway");
}
await page.screenshot({ path: `${shotDir}/03-final.png`, fullPage: true });

const remainingText = await page.locator("text=Remaining").first().isVisible().catch(() => false);
console.log("Economy panel 'Remaining' stat visible:", remainingText);

// Close the report dialog if it auto-opened
await page.keyboard.press("Escape").catch(() => {});

// Rogue demo
await page.click('button:has-text("Fire Rogue Demo")');
await page.waitForSelector("text=CIRCUIT BREAKER", { timeout: 15000 }).catch(() => console.log("Circuit breaker banner did not appear"));
await page.screenshot({ path: `${shotDir}/04-rogue.png`, fullPage: true });

// Toggle theme
await page.click('button[aria-label="Toggle theme"]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${shotDir}/04b-light-theme.png`, fullPage: true });
await page.click('button[aria-label="Toggle theme"]');

// Reset
await page.click('button:has-text("Reset")');
await page.waitForTimeout(1000);
await page.screenshot({ path: `${shotDir}/05-reset.png`, fullPage: true });

console.log("Console errors captured:", consoleErrors.length);
for (const e of consoleErrors.slice(0, 20)) console.log(" -", e);

await browser.close();
