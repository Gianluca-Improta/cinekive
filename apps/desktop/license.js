/**
 * Cinekive Pro license store (desktop).
 * Activates via Gumroad license key → API /license/activate → license.json
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { userDataRoot } = require("./paths");

const PRO_URL =
  process.env.CINEKIVE_PRO_URL || "https://gianlucaimprota.gumroad.com/l/cinekive-pro";

function licensePath() {
  return path.join(userDataRoot(), "license.json");
}

function machineId() {
  const raw = [process.platform, process.arch, require("os").hostname(), userDataRoot()].join("|");
  return crypto.createHash("sha256").update(raw).digest("hex").slice(0, 32);
}

function readLicense() {
  const p = licensePath();
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

function isPro() {
  const doc = readLicense();
  return Boolean(doc && String(doc.tier || "").toLowerCase() === "pro");
}

function publicStatus() {
  const doc = readLicense();
  if (!doc || String(doc.tier || "").toLowerCase() !== "pro") {
    return {
      tier: "free",
      isPro: false,
      upgradeUrl: PRO_URL,
      priceUsd: 19,
      earlyBirdUsd: 12,
    };
  }
  const key = String(doc.licenseKey || "");
  const hint = key.length >= 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : "••••";
  return {
    tier: "pro",
    isPro: true,
    email: doc.email || null,
    keyHint: hint,
    activatedAt: doc.activatedAt || null,
    upgradeUrl: PRO_URL,
    priceUsd: 19,
    earlyBirdUsd: 12,
  };
}

function requestJson(url, { method = "GET", body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;
    const data = body ? JSON.stringify(body) : null;
    const req = lib.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === "https:" ? 443 : 80),
        path: u.pathname + u.search,
        method,
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
          ...headers,
        },
        timeout: 20000,
      },
      (res) => {
        let buf = "";
        res.on("data", (c) => {
          buf += c;
        });
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode || 0, data: buf ? JSON.parse(buf) : {} });
          } catch {
            resolve({ status: res.statusCode || 0, data: { raw: buf } });
          }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("License request timed out"));
    });
    if (data) req.write(data);
    req.end();
  });
}

/**
 * Activate via local API (preferred) so Docker/native share the same license.json.
 */
async function activateViaApi(licenseKey, email) {
  const api = process.env.CINEKIVE_API_URL || "http://127.0.0.1:8000";
  const base = api.replace(/\/health$/, "").replace(/\/$/, "");
  const res = await requestJson(`${base}/license/activate`, {
    method: "POST",
    body: {
      license_key: licenseKey,
      email: email || undefined,
      machine_id: machineId(),
    },
  });
  if (res.status >= 400 || res.data?.ok === false) {
    const msg = res.data?.message || res.data?.detail || `HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  // Mirror into desktop userData if API wrote elsewhere
  if (res.data?.entitlements?.is_pro) {
    const existing = readLicense();
    if (!existing || existing.tier !== "pro") {
      // API wrote the file; try copy from known API path if needed
      const apiPath = res.data.path;
      if (apiPath && fs.existsSync(apiPath) && path.resolve(apiPath) !== path.resolve(licensePath())) {
        fs.mkdirSync(path.dirname(licensePath()), { recursive: true });
        fs.copyFileSync(apiPath, licensePath());
      }
    }
  }
  return res.data;
}

function deactivateLocal() {
  const p = licensePath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
  return { ok: true, ...publicStatus() };
}

module.exports = {
  PRO_URL,
  licensePath,
  machineId,
  readLicense,
  isPro,
  publicStatus,
  activateViaApi,
  deactivateLocal,
};
