import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (msg) => console.log("PAGE:", msg.text()));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
const btn = page.getByRole("link", { name: /Launch console/i }).first();
await btn.waitFor();
await btn.hover();
await page.waitForTimeout(500);
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
await browser.close();
