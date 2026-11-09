// Public demo web server (no dependencies):
//   /          -> PlayR app (Expo web export)        ../.data/web-app
//   /classic/  -> previous React web app (vite build) ../.data/web-classic
//   /api, /uploads (HTTP + WebSocket) -> FastAPI on 127.0.0.1:8000
// Binds to 127.0.0.1 only; the Cloudflare tunnel is the public entry point.
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", ".data");
const APP = process.env.WEB_ROOT ? path.resolve(process.env.WEB_ROOT) : path.join(ROOT, "web-app");
const CLASSIC = path.join(ROOT, "web-classic");
const API = { host: "127.0.0.1", port: Number(process.env.API_PORT ?? 8000) };
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const isApi = (u) => u.startsWith("/api/") || u.startsWith("/uploads/");
const PUBLIC_URL = (process.env.PUBLIC_URL ?? "").replace(/\/$/, "");

// ---- Link previews (WhatsApp, iMessage, Slack read <meta> tags without running JS) ----
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const DEFAULT_META = { title: "PlayR", description: "Find players, teams and grounds near you. Cricket, badminton and pickleball." };
function originOf(req) {
  if (PUBLIC_URL) return PUBLIC_URL;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "";
  return host ? `https://${host}` : "";
}
function metaTags(m, origin, pathName) {
  const img = origin ? `${origin}/og/playr-card.png` : "/og/playr-card.png";
  const tags = [
    ["property", "og:type", "website"], ["property", "og:site_name", "PlayR"], ["property", "og:title", m.title],
    ["property", "og:description", m.description], ["property", "og:image", img], ["property", "og:image:width", "1200"],
    ["property", "og:image:height", "630"], ["property", "og:image:alt", "PlayR"], ["property", "og:url", `${origin}${pathName}`],
    ["name", "twitter:card", "summary_large_image"], ["name", "description", m.description],
  ];
  return tags.map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}">`).join("") + `<title>${esc(m.title)}</title>`;
}
async function joinMeta(code) {
  try {
    const r = await fetch(`http://${API.host}:${API.port}/api/v1/join/${encodeURIComponent(code)}`, { signal: AbortSignal.timeout(1500) });
    if (r.status === 404 || r.status === 410) return { title: "This PlayR invite has expired", description: "Ask your captain for a new link." };
    if (!r.ok) return null;
    const d = (await r.json()).data;
    const when = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: d.timezone || "Asia/Kolkata" }).format(new Date(d.start_at));
    const place = d.area ? ` · ${d.area}` : "";
    const spots = d.status === "open" && d.spots_left > 0 ? ` · ${d.spots_left} spot${d.spots_left === 1 ? "" : "s"} left` : d.status === "open" ? " · Squad full" : "";
    return { title: `${d.team_name}: ${d.match_title}`, description: `${when}${place}${spots}. Tap to add yourself to the squad on PlayR.` };
  } catch { return null; }
}
async function appHtml(req, res, pathName) {
  const m = pathName.match(/^\/join\/([A-Za-z0-9_-]{4,40})\/?$/);
  const meta = (m && (await joinMeta(m[1]))) || DEFAULT_META;
  const html = fs.readFileSync(path.join(APP, "index.html"), "utf8").replace(/<title>[^<]*<\/title>/, "").replace("</head>", `${metaTags(meta, originOf(req), pathName)}</head>`);
  res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-cache", "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
  res.end(html);
}

function file(res, base, rel, fallback) {
  let f = path.normalize(path.join(base, rel));
  if (!f.startsWith(base)) { res.writeHead(400); return res.end(); }
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    const html = `${f.replace(/\/$/, "")}.html`;
    f = fs.existsSync(html) ? html : path.join(base, fallback);
  }
  const immutable = /\/(_expo|assets)\//.test(f);
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream", "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin" });
  fs.createReadStream(f).pipe(res);
}

const server = http.createServer((req, res) => {
  const url = req.url ?? "/";
  if (isApi(url)) {
    const xff = [req.headers["x-forwarded-for"], req.socket.remoteAddress].filter(Boolean).join(", ");
    const p = http.request({ ...API, path: url, method: req.method, headers: { ...req.headers, "x-forwarded-for": xff } }, (r) => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    p.on("error", () => { if (!res.headersSent) res.writeHead(502); res.end(); });
    return req.pipe(p);
  }
  const clean = decodeURIComponent(url.split("?")[0]);
  if (clean === "/classic") { res.writeHead(301, { location: "/classic/" }); return res.end(); }
  if (clean.startsWith("/classic/")) return file(res, CLASSIC, clean.slice("/classic".length), "index.html");
  const f = path.normalize(path.join(APP, clean));
  const isAsset = f.startsWith(APP) && fs.existsSync(f) && !fs.statSync(f).isDirectory() && !f.endsWith(".html");
  if (!isAsset && req.method === "GET") return void appHtml(req, res, clean).catch(() => file(res, APP, clean, "index.html"));
  return file(res, APP, clean, "index.html");
});

server.on("upgrade", (req, socket, head) => {
  if (!isApi(req.url ?? "")) return socket.destroy();
  const up = net.connect(API.port, API.host, () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, "127.0.0.1", () => console.log(`PlayR web on http://127.0.0.1:${PORT}`));
