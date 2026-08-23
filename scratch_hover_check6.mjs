import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
const btn = page.getByRole("link", { name: /Launch console/i }).nth(1);
await btn.waitFor();
const box = await btn.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

const samples = await page.evaluate(async () => {
  const el = document.querySelectorAll("a span span")[1];
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push(el.textContent);
    await new Promise((r) => setTimeout(r, 25));
  }
  return out;
});
console.log(samples);
await browser.close();
