import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = __dirname;
const BASE = process.env.CINEKIVE_URL || "http://127.0.0.1:3000";
const FILMGRAB = "68b6eb1b-6e56-4350-a0a7-cd709782c64e";
const MISC = "53b3edd3-931f-4a95-a21a-7b043a674dfb";
const NSS = "8025d6be-2060-4265-92f7-537288008a1c";
const HUAWEI = "866e5ea5-a796-44e9-8a07-b5afec0bc6c9";

async function scrub(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    document.querySelectorAll("nextjs-portal").forEach((el) => el.remove());
    for (const el of document.querySelectorAll("button, div, a, span")) {
      const t = (el.textContent || "").replace(/\s+/g, " ").trim();
      if (/^\d+ Issues?$/.test(t)) el.style.setProperty("display", "none", "important");
      if (/^Activity(\s+\d+)?$/.test(t)) el.style.setProperty("display", "none", "important");
    }
    // Hide Next.js / React error overlays if present
    document.querySelectorAll("[data-nextjs-dialog], #__next-build-watcher").forEach((el) => {
      el.style.setProperty("display", "none", "important");
    });
  });
}

async function waitForThumbs(page, min = 6, timeout = 90000) {
  await page
    .waitForFunction(
      (n) => {
        const imgs = [...document.querySelectorAll("img")];
        const loaded = imgs.filter((i) => i.naturalWidth > 40 && i.offsetParent !== null);
        const empty = document.body.innerText.includes("No shots yet");
        return loaded.length >= n && !empty;
      },
      min,
      { timeout }
    )
    .catch(() => {});
}

async function snap(page, file) {
  await dismissTour();
  await scrub(page);
  await page.waitForTimeout(700);
  const dest = path.join(OUT, file);
  await page.screenshot({ path: dest, type: "jpeg", quality: 88 });
  console.log("wrote", file, fs.statSync(dest).size);
}

async function clickTab(page, nameRe) {
  const tab = page.getByRole("button", { name: nameRe }).first();
  if ((await tab.count()) > 0) {
    await tab.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }
  const textTab = page.locator("button, a").filter({ hasText: nameRe }).first();
  if ((await textTab.count()) > 0) {
    await textTab.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1200);
    return true;
  }
  return false;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "dark",
});
await context.addInitScript(() => {
  localStorage.setItem("cinekive.onboarding.v1", "done");
  localStorage.setItem("cinekive.onboarding.v2", "done");
  localStorage.setItem("cinekive.preferInspector", "1");
  localStorage.setItem("cinekive.appearance", "dark");
  document.documentElement.dataset.theme = "dark";
});
const page = await context.newPage();
page.setDefaultTimeout(30000);

async function dismissTour() {
  const skip = page.getByRole("button", { name: /^skip$/i });
  if ((await skip.count()) > 0) {
    await skip.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(400);
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.evaluate(() => {
    localStorage.setItem("cinekive.onboarding.v1", "done");
    localStorage.setItem("cinekive.onboarding.v2", "done");
    document.querySelectorAll("[role='dialog']").forEach((el) => {
      const t = (el.textContent || "").toLowerCase();
      if (t.includes("welcome to cinekive") || t.includes("tour ·")) {
        el.remove();
      }
    });
  });
}

console.log("base", BASE);

// 1) Discovery
await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
await dismissTour();
await waitForThumbs(page, 8);
await page.waitForTimeout(2500);
await dismissTour();
await snap(page, "ui-discovery.jpg");

// 2) Search on FilmGrab (craft words)
await page.goto(`${BASE}/projects/${FILMGRAB}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await dismissTour();
await waitForThumbs(page, 8);
await page.waitForTimeout(2000);
await snap(page, "ui-library.jpg");

const search = page.getByPlaceholder(/search/i).first();
if ((await search.count()) > 0) {
  await search.fill("neon light lens");
  await search.press("Enter");
  await page.waitForTimeout(5500);
  await waitForThumbs(page, 4, 60000);
  await snap(page, "ui-search.jpg");
}

// 3) Commercial shelves (Huawei preferred; NSS fallback)
await page.goto(`${BASE}/projects/${HUAWEI}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await dismissTour();
await waitForThumbs(page, 6);
await page.waitForTimeout(1500);
const shelfOk =
  (await clickTab(page, /props/i)) ||
  (await clickTab(page, /locations/i)) ||
  (await clickTab(page, /wardrobe/i));
if (!shelfOk) {
  await page.goto(`${BASE}/projects/${NSS}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await dismissTour();
  await waitForThumbs(page, 6);
  await page.waitForTimeout(1500);
}
await snap(page, "ui-commercials.jpg");

// 4) Moodboard
await page.goto(`${BASE}/projects/${MISC}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await dismissTour();
await waitForThumbs(page, 4, 60000).catch(() => {});
await clickTab(page, /moodboard/i);
await page.waitForTimeout(2500);
await snap(page, "ui-moodboard.jpg");

// 5) Archives hub
await page.goto(`${BASE}/archives`, { waitUntil: "domcontentloaded", timeout: 120000 });
await dismissTour();
await page.waitForTimeout(2800);
await snap(page, "ui-archives.jpg");

await browser.close();
console.log("done", OUT);
