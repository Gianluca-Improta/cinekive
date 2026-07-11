import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = process.env.CINEKIVE_URL || "http://localhost:3000";

async function prep(context) {
  await context.addInitScript(() => {
    try {
      localStorage.setItem("cinekive.onboarding.v1", "done");
      localStorage.setItem("cinekive.preferInspector", "1");
      localStorage.setItem("cinekive.appearance", "dark");
      document.documentElement.dataset.theme = "dark";
      document.documentElement.classList.add("dark");
    } catch (_) {}
  });
}

async function scrub(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    document
      .querySelectorAll("[data-next-badge-root], [data-nextjs-toast], [data-nextjs-dialog-overlay]")
      .forEach((el) => el.remove());
    for (const el of document.querySelectorAll("button, a, div")) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^\d+ Issues?$/.test(t)) el.style.setProperty("display", "none", "important");
      if (/^Activity(\s+\d+)?$/.test(t)) el.style.setProperty("display", "none", "important");
    }
  });
}

async function shot(page, urlPath, file, waitMs = 2800) {
  await page.goto(`${BASE}${urlPath}`, { waitUntil: "networkidle", timeout: 90000 });
  await page.waitForTimeout(waitMs);
  await scrub(page);
  await page.waitForTimeout(200);
  await page.screenshot({ path: path.join(OUT, file), type: "png" });
  console.log("wrote", file);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
await prep(context);
const page = await context.newPage();

await shot(page, "/", "ui-discovery.png", 4500);

await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(1500);
await scrub(page);
const href = await page.locator('a[href^="/projects/"]').first().getAttribute("href");
if (href) {
  await shot(page, href, "ui-project.png", 3500);
  await page.getByRole("button", { name: /moodboard/i }).click();
  await page.waitForTimeout(3000);
  await scrub(page);
  await page.screenshot({ path: path.join(OUT, "ui-moodboard.png"), type: "png" });
  console.log("wrote ui-moodboard.png");
}

await shot(page, "/archives", "ui-archives.png", 3000);

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle", timeout: 90000 });
await page.waitForTimeout(2500);
await scrub(page);
await page.evaluate(() => {
  const scroller = document.querySelector(".overflow-y-auto");
  if (scroller) scroller.scrollTop = scroller.scrollHeight;
});
await page.waitForTimeout(500);
await scrub(page);
await page.screenshot({ path: path.join(OUT, "ui-settings.png"), type: "png" });
console.log("wrote ui-settings.png");

await browser.close();
