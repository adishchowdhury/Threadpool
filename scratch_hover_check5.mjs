import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
const btn = page.getByRole("link", { name: /Launch console/i }).nth(1);
await btn.waitFor();

const info = await btn.evaluate((el) => {
  const spans = el.querySelectorAll("span span");
  return Array.from(spans).map((s) => ({
    text: s.textContent,
    cls: s.className,
    visibility: getComputedStyle(s).visibility,
    display: getComputedStyle(s).display,
  }));
});
console.log(JSON.stringify(info, null, 2));
console.log("outerHTML:", await btn.evaluate((el) => el.outerHTML));

await browser.close();
