import { chromium } from "playwright";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = process.env.CINEKIVE_URL || "http://localhost:3000";

const FILMGRAB = "68b6eb1b-6e56-4350-a0a7-cd709782c64e";
const MISC = "53b3edd3-931f-4a95-a21a-7b043a674dfb";
const NSS = "8025d6be-2060-4265-92f7-537288008a1c";
const SHOTDECK = "6dbcf19c-440d-408e-9918-e3fc09c30573";

async function scrub(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    for (const el of document.querySelectorAll("button, div, a")) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^\d+ Issues?$/.test(t)) el.style.setProperty("display", "none", "important");
      if (/^Activity(\s+\d+)?$/.test(t)) el.style.setProperty("display", "none", "important");
    }
  });
}

async function waitForThumbs(page, timeout = 45000) {
  await page.waitForFunction(
    () => {
      const imgs = [...document.querySelectorAll("img")];
      const loaded = imgs.filter((i) => i.naturalWidth > 40 && i.offsetParent !== null);
      const loading = document.body.innerText.includes("Loading shots");
      return loaded.length >= 4 && !loading;
    },
    { timeout }
  );
}

async function snap(page, file) {
  await scrub(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, file), type: "png" });
  console.log("wrote", file);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
await context.addInitScript(() => {
  localStorage.setItem("cinekive.onboarding.v1", "done");
  localStorage.setItem("cinekive.preferInspector", "1");
  localStorage.setItem("cinekive.appearance", "dark");
  document.documentElement.dataset.theme = "dark";
});
const page = await context.newPage();

// Discovery browse (no search hang)
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForThumbs(page).catch(() => {});
await page.waitForTimeout(1500);
await snap(page, "ui-discovery.png");

// Click a shot → inspector
const thumb = page.locator("img").filter({ hasNot: page.locator("[alt='']") }).first();
const clickable = page.locator("button").filter({ has: page.locator("img") }).first();
if ((await clickable.count()) > 0) {
  await clickable.click();
  await page.waitForTimeout(2500);
  await snap(page, "ui-inspector.png");
  const full = page.getByRole("button", { name: /full panel/i });
  if ((await full.count()) > 0) {
    await full.click();
    await page.waitForTimeout(1800);
    await snap(page, "ui-stage.png");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(600);
  } else {
    await page.keyboard.press("Escape");
  }
}

// FilmGrab library grid — the money shot
await page.goto(`${BASE}/projects/${FILMGRAB}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForThumbs(page).catch(async () => {
  await page.goto(`${BASE}/projects/${MISC}`, { waitUntil: "domcontentloaded" });
  await waitForThumbs(page);
});
await page.waitForTimeout(1500);
await snap(page, "ui-library.png");
await snap(page, "ui-project.png");

// Search within FilmGrab via UI
const search = page.getByPlaceholder(/search/i).first();
if ((await search.count()) > 0) {
  await search.fill("summer");
  await search.press("Enter");
  await page.waitForTimeout(5000);
  await waitForThumbs(page).catch(() => {});
  await snap(page, "ui-search.png");
}

// NSS commercials with motion
await page.goto(`${BASE}/projects/${NSS}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForThumbs(page).catch(() => {});
await page.waitForTimeout(2000);
await snap(page, "ui-commercials.png");

// Moodboard on MISC (known to have boards)
await page.goto(`${BASE}/projects/${MISC}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForThumbs(page).catch(() => {});
await page.getByRole("button", { name: /moodboard/i }).click();
await page.waitForTimeout(3000);
// If empty board CTA, create board
const newBoard = page.getByRole("button", { name: /new board/i });
if ((await newBoard.count()) > 0) {
  await newBoard.click();
  await page.waitForTimeout(2000);
}
// Add clips from rail
const addBtns = page.locator("aside button[title*='Add']");
const n = Math.min(8, await addBtns.count());
for (let i = 0; i < n; i++) {
  await addBtns.nth(i).hover().catch(() => {});
  await addBtns.nth(i).click({ force: true }).catch(() => {});
  await page.waitForTimeout(350);
}
await page.waitForTimeout(2000);
await snap(page, "ui-moodboard.png");

await page.goto(`${BASE}/archives`, { waitUntil: "domcontentloaded", timeout: 90000 });
await page.waitForTimeout(2500);
await snap(page, "ui-archives.png");

// ShotDeck stills
await page.goto(`${BASE}/projects/${SHOTDECK}`, { waitUntil: "domcontentloaded", timeout: 90000 });
await waitForThumbs(page).catch(() => {});
await page.waitForTimeout(1500);
await snap(page, "ui-shotdeck.png");

await browser.close();
console.log("done");
