// Records a video of the replay playing from t=0 at 60x.
import { chromium } from "playwright";
import { mkdirSync, renameSync, readdirSync } from "node:fs";

const OUT = process.env.VID_DIR ?? "/tmp/ui-video";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 950 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 950 } },
});
const page = await ctx.newPage();
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(500);

await page.selectOption(".speed-select", "60");
await page.locator(".btn.icon").click(); // restart from 0
await page.waitForTimeout(8200); // 412s timeline at 60x ≈ 6.9s
await page.locator(".node").nth(6).click(); // open final iteration detail
await page.waitForTimeout(1500);

await ctx.close();
await browser.close();
const file = readdirSync(OUT).find((f) => f.endsWith(".webm"));
renameSync(`${OUT}/${file}`, `${OUT}/replay-demo.webm`);
console.log("video:", `${OUT}/replay-demo.webm`);
