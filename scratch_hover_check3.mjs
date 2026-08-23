import { chromium } from "playwright";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on("console", (msg) => console.log("PAGE:", msg.text()));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });
const btn = page.getByRole("link", { name: /Launch console/i }).nth(1); // hero one
await btn.waitFor();
console.log("---hover start---");
const box = await btn.boundingBox();
console.log("box:", box);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
console.log("---moved, waiting---");
await page.waitForTimeout(600);
console.log("---done waiting---");
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
await browser.close();
