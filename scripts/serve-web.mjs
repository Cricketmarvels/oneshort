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
const APP = path.join(ROOT, "web-app");
const CLASSIC = path.join(ROOT, "web-classic");
const API = { host: "127.0.0.1", port: Number(process.env.API_PORT ?? 8000) };
const PORT = Number(process.env.PORT ?? 4173);
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml",
  ".ttf": "font/ttf", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon", ".webmanifest": "application/manifest+json" };
const isApi = (u) => u.startsWith("/api/") || u.startsWith("/uploads/");

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
