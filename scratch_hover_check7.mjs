import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
const btn = page.getByRole("link", { name: /Launch console/i }).nth(1);
await btn.waitFor();
const box = await btn.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;
await page.mouse.move(cx, cy);

const samples = await page.evaluate(async ({ cx, cy }) => {
  const target = document.elementFromPoint(cx, cy);
  const link = target.closest("a");
  const visibleSpan = link.querySelectorAll("span span")[1];
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push(visibleSpan.textContent);
    await new Promise((r) => setTimeout(r, 25));
  }
  return out;
}, { cx, cy });
console.log(samples);
await browser.close();
