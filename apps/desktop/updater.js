/**
 * App update checks — GitHub Releases (+ electron-updater when packaged).
 */

const https = require("https");
const { app, dialog, shell } = require("electron");

const REPO = "Gianluca-Improta/cinekive";
const RELEASES_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

function parseSemver(v) {
  const m = String(v || "")
    .replace(/^v/i, "")
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isNewer(remote, local) {
  const a = parseSemver(remote);
  const b = parseSemver(local);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] > b[i]) return true;
    if (a[i] < b[i]) return false;
  }
  return false;
}

function fetchJson(url, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          "User-Agent": `Cinekive-Desktop/${app.getVersion()}`,
          Accept: "application/vnd.github+json",
        },
      },
      (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return fetchJson(res.headers.location, timeoutMs).then(resolve, reject);
        }
        let body = "";
        res.on("data", (d) => {
          body += d;
          if (body.length > 2_000_000) {
            req.destroy();
            reject(new Error("Response too large"));
          }
        });
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`GitHub HTTP ${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error("Update check timed out"));
    });
  });
}

/**
 * @returns {Promise<null | { tag: string, name: string, url: string, notes: string }>}
 */
async function fetchLatestRelease() {
  const data = await fetchJson(RELEASES_LATEST);
  const tag = data.tag_name || "";
  return {
    tag,
    name: data.name || tag,
    url: data.html_url || RELEASES_PAGE,
    notes: String(data.body || "").slice(0, 1200),
  };
}

async function checkGithubUpdate() {
  const current = app.getVersion();
  const latest = await fetchLatestRelease();
  if (!isNewer(latest.tag, current)) return { update: false, current, latest };
  return { update: true, current, latest };
}

/**
 * Prefer electron-updater for installed NSIS builds; fall back to GitHub notify.
 */
async function checkForUpdates({ silent = true } = {}) {
  const current = app.getVersion();

  // Packaged NSIS: try auto-download via electron-updater when available
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = false;
      autoUpdater.autoInstallOnAppQuit = true;

      return await new Promise((resolve) => {
        let settled = false;
        const done = (result) => {
          if (settled) return;
          settled = true;
          resolve(result);
        };

        autoUpdater.once("update-available", async (info) => {
          const ver = info.version || "?";
          const box = await dialog.showMessageBox({
            type: "info",
            buttons: ["Download update", "Later"],
            defaultId: 0,
            cancelId: 1,
            title: "Update available",
            message: `Cinekive ${ver} is available`,
            detail: `You have ${current}.\n\nDownload and install when ready? The app will quit to apply the update.`,
          });
          if (box.response === 0) {
            try {
              await autoUpdater.downloadUpdate();
              dialog
                .showMessageBox({
                  type: "info",
                  buttons: ["Install and restart", "Later"],
                  defaultId: 0,
                  message: "Update downloaded",
                  detail: "Install now? Unsaved work in other apps is fine — only Cinekive will restart.",
                })
                .then((r) => {
                  if (r.response === 0) autoUpdater.quitAndInstall(false, true);
                });
            } catch (e) {
              await shell.openExternal(RELEASES_PAGE);
              if (!silent) {
                dialog.showErrorBox(
                  "Update download failed",
                  `${e.message || e}\n\nOpened the releases page instead.`
                );
              }
            }
          }
          done({ update: true, source: "electron-updater", version: ver });
        });

        autoUpdater.once("update-not-available", () => {
          if (!silent) {
            dialog.showMessageBox({
              type: "info",
              message: "You're up to date",
              detail: `Cinekive ${current} is the latest release.`,
            });
          }
          done({ update: false, source: "electron-updater", current });
        });

        autoUpdater.once("error", async () => {
          // Fall through to GitHub API notify
          try {
            const gh = await checkGithubUpdate();
            if (gh.update) {
              await promptGithubUpdate(gh, { silent: false });
              done({ ...gh, source: "github-fallback" });
            } else {
              if (!silent) {
                dialog.showMessageBox({
                  type: "info",
                  message: "You're up to date",
                  detail: `Cinekive ${current} is the latest release.`,
                });
              }
              done({ update: false, source: "github-fallback", current });
            }
          } catch (e) {
            if (!silent) {
              dialog.showErrorBox("Update check failed", String(e.message || e));
            }
            done({ update: false, error: String(e.message || e) });
          }
        });

        autoUpdater.checkForUpdates().catch(async () => {
          try {
            const gh = await checkGithubUpdate();
            if (gh.update) await promptGithubUpdate(gh, { silent: false });
            else if (!silent) {
              dialog.showMessageBox({
                type: "info",
                message: "You're up to date",
                detail: `Cinekive ${current} is the latest release.`,
              });
            }
            done(gh);
          } catch (e) {
            if (!silent) dialog.showErrorBox("Update check failed", String(e.message || e));
            done({ update: false, error: String(e.message || e) });
          }
        });
      });
    } catch {
      /* electron-updater missing — GitHub only */
    }
  }

  try {
    const gh = await checkGithubUpdate();
    if (gh.update) {
      await promptGithubUpdate(gh, { silent });
      return { ...gh, source: "github" };
    }
    if (!silent) {
      await dialog.showMessageBox({
        type: "info",
        message: "You're up to date",
        detail: `Cinekive ${current} is the latest release.`,
      });
    }
    return { ...gh, source: "github" };
  } catch (e) {
    if (!silent) dialog.showErrorBox("Update check failed", String(e.message || e));
    return { update: false, error: String(e.message || e) };
  }
}

async function promptGithubUpdate(gh, { silent = true } = {}) {
  try {
    const { readConfig, writeConfig } = require("./paths");
    const cfg = readConfig();
    if (silent && cfg.lastUpdatePrompt === gh.latest.tag) return;
    writeConfig({ lastUpdatePrompt: gh.latest.tag });
  } catch (_) {}

  const box = await dialog.showMessageBox({
    type: "info",
    buttons: ["Open download page", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update available",
    message: `Cinekive ${gh.latest.tag} is available`,
    detail: `You have ${gh.current}.\n\n${(gh.latest.notes || "").slice(0, 400) || "Bug fixes and improvements."}`,
  });
  if (box.response === 0) {
    await shell.openExternal(gh.latest.url || RELEASES_PAGE);
  }
}

module.exports = {
  checkForUpdates,
  checkGithubUpdate,
  isNewer,
  RELEASES_PAGE,
};
