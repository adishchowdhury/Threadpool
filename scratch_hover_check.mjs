import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", (err) => errors.push(String(err)));
page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

const btn = page.getByRole("link", { name: /Launch console/i }).first();
await btn.waitFor();
const before = await btn.innerText();
console.log("before hover:", JSON.stringify(before));

await btn.hover();
await page.waitForTimeout(60);
const mid1 = await btn.innerText();
console.log("mid1:", JSON.stringify(mid1));
await page.waitForTimeout(60);
const mid2 = await btn.innerText();
console.log("mid2:", JSON.stringify(mid2));

await page.waitForTimeout(500);
const after = await btn.innerText();
console.log("after settle:", JSON.stringify(after));

console.log("errors:", errors);
await browser.close();
