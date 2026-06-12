// Visual verification: captures key UI states from the running dev server.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const OUT = process.env.SHOT_DIR ?? "/tmp/ui-shots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE ERROR:", m.text());
});
page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));

await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(800);

// 1. Live edge (full finished loop)
await page.screenshot({ path: `${OUT}/1-live-edge.png` });

// 2. Mid-replay: scrub to ~52% (iteration 4 running, after first escalation)
const track = page.locator(".scrubber");
const box = await track.boundingBox();
await page.mouse.click(box.x + box.width * 0.55, box.y + box.height / 2);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/2-mid-replay-running.png` });

// 3. Hover a finished node
await page.locator(".node").nth(2).hover();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/3-hover-card.png` });

// 4. Back to live edge, click iteration 4 node -> detail panel
await page.locator(".live-btn").click();
await page.waitForTimeout(500);
await page.locator(".node").nth(4).click();
await page.waitForTimeout(500);
await page.screenshot({ path: `${OUT}/4-detail-panel.png` });

// 5. Rubric editor sidebar with a queued comment-criterion
await page.locator("text=Edit rubric").click();
await page.waitForTimeout(400);
await page.fill(".comment-box textarea", "the limiter must use Redis, not in-memory state");
await page.locator("text=Queue as new criterion").click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/5-rubric-editor.png` });

// 6. Early replay: rubric generation phase
await page.mouse.click(box.x + box.width * 0.02, box.y + box.height / 2);
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/6-rubric-generating.png` });

await browser.close();
console.log("screenshots written to", OUT);
