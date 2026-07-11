/**
 * LAN discovery and bind helpers for phone/tablet access on the same WiFi.
 */

const os = require("os");

function getPrimaryLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    if (/vmware|virtual|vethernet|hyper-v|loopback|docker|vbox|wsl/i.test(lower)) continue;
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (!net.address || net.address.startsWith("169.254.")) continue;
      candidates.push({ name, address: net.address });
    }
  }
  const wifi = candidates.find((c) => /wi-?fi|wlan|en0/i.test(c.name));
  if (wifi) return wifi.address;
  return candidates[0]?.address || null;
}

function buildCorsOrigins(lanIp, lanAccess = true) {
  const origins = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);
  if (lanAccess && lanIp) {
    origins.add(`http://${lanIp}:3000`);
  }
  return [...origins].join(",");
}

function getBindHost(lanAccess = true) {
  return lanAccess ? "0.0.0.0" : "127.0.0.1";
}

function getLanUrls(lanAccess = true) {
  const ip = lanAccess ? getPrimaryLanIp() : null;
  return {
    ip,
    webUrl: ip ? `http://${ip}:3000` : null,
    apiUrl: ip ? `http://${ip}:8000` : null,
    localWebUrl: "http://localhost:3000",
    localApiUrl: "http://localhost:8000",
  };
}

module.exports = {
  getPrimaryLanIp,
  buildCorsOrigins,
  getBindHost,
  getLanUrls,
};
