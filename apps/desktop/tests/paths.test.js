/**
 * Desktop shell checks — per-install secrets and network defaults.
 *
 * Run with: node --test tests/
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

function withUserData(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cinekive-test-"));
  process.env.CINEKIVE_USER_DATA = dir;
  try {
    // Fresh module instance so the env var is picked up.
    delete require.cache[require.resolve("../paths")];
    return fn(require("../paths"), dir);
  } finally {
    delete process.env.CINEKIVE_USER_DATA;
    delete require.cache[require.resolve("../paths")];
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

test("LAN access is off by default", () => {
  withUserData((paths) => {
    assert.strictEqual(paths.readConfig().lanAccess, false);
  });
});

test("LAN access stays off when the config has no key", () => {
  withUserData((paths, dir) => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ firstRunComplete: true }),
      "utf8"
    );
    assert.strictEqual(paths.readConfig().lanAccess, false);
  });
});

test("an explicit LAN opt-in is respected", () => {
  withUserData((paths) => {
    paths.writeConfig({ lanAccess: true });
    assert.strictEqual(paths.readConfig().lanAccess, true);
  });
});

test("access secrets are generated once and stay stable", () => {
  withUserData((paths) => {
    const first = paths.readAccessSecrets();
    assert.ok(first.apiToken && first.apiToken.length >= 32);
    assert.ok(first.licenseSecret && first.licenseSecret.length >= 32);

    const second = paths.readAccessSecrets();
    assert.strictEqual(second.apiToken, first.apiToken);
    assert.strictEqual(second.licenseSecret, first.licenseSecret);
  });
});

test("access secrets are written outside the shared config", () => {
  withUserData((paths, dir) => {
    paths.readAccessSecrets();
    const accessFile = path.join(dir, "access.json");
    assert.ok(fs.existsSync(accessFile), "access.json should exist");
    const parsed = JSON.parse(fs.readFileSync(accessFile, "utf8"));
    assert.ok(parsed.apiToken);
    assert.ok(parsed.licenseSecret);
  });
});

test("the bind host follows the LAN switch", () => {
  const network = require("../network");
  assert.strictEqual(network.getBindHost(false), "127.0.0.1");
  assert.strictEqual(network.getBindHost(true), "0.0.0.0");
  assert.strictEqual(network.getLanUrls(false).ip, null);
});
