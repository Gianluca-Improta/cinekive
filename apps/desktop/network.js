/**
 * LAN discovery and bind helpers for phone/tablet access on the same WiFi.
 */

const os = require("os");

function getPrimaryLanIp() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    const lower = name.toLowerCase();
    // Skip VM / container / VPN-tun adapters — they poison phone-on-WiFi URLs
    if (
      /vmware|virtual|vethernet|hyper-v|loopback|docker|vbox|wsl|singbox|tun|tap|tailscale|zerotier|hamachi/i.test(
        lower
      )
    ) {
      continue;
    }
    for (const net of nets[name] || []) {
      if (net.family !== "IPv4" || net.internal) continue;
      if (!net.address || net.address.startsWith("169.254.")) continue;
      // Docker / WSL bridge ranges often still appear on oddly named NICs
      if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)) continue;
      if (net.address.startsWith("172.18.") || net.address.startsWith("172.29.")) continue;
      candidates.push({ name, address: net.address });
    }
  }
  const wifi = candidates.find((c) => /wi-?fi|wlan|en0|ethernet/i.test(c.name));
  if (wifi) return wifi.address;
  // Prefer RFC1918 private LAN over anything exotic
  const privateLan = candidates.find((c) =>
    /^(192\.168\.|10\.)/.test(c.address)
  );
  return privateLan?.address || candidates[0]?.address || null;
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
