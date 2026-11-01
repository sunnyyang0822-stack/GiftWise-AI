// 仅供渲染答辩页的本地静态服务（项目内，端口 8921）
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const ROOT = "E:/黑客松/.tools/ppt/deck";
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".svg": "image/svg+xml" };
createServer(async (req, res) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
  try { const body = await readFile(path); res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-store" }); res.end(body); }
  catch { res.writeHead(404); res.end(); }
}).listen(8921, "127.0.0.1", () => console.log("deck on http://127.0.0.1:8921/"));
