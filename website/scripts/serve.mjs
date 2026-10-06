import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve(import.meta.dirname, "../dist");
const port = Number(process.env.PORT ?? 4321);
const { base } = JSON.parse(await readFile(resolve(root, "build.json"), "utf8"));
const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".txt": "text/plain",
  ".xml": "application/xml",
};
createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (!path.startsWith(base)) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    let file = resolve(root, path.slice(base.length));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory()) file = resolve(file, "index.html");
    } catch {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end(await readFile(resolve(root, "404.html")));
      return;
    }
    const data = await readFile(file);
    const headers = {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": "no-cache",
      "Accept-Ranges": "bytes",
    };
    const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Math.min(range[2] ? Number(range[2]) : data.length - 1, data.length - 1);
      if (start > end) {
        res.writeHead(416, { "Content-Range": `bytes */${data.length}` });
        res.end();
        return;
      }
      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Content-Length": end - start + 1,
      });
      res.end(data.subarray(start, end + 1));
    } else {
      res.writeHead(200, { ...headers, "Content-Length": data.length });
      res.end(data);
    }
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("Preview server error");
  }
}).listen(port, "127.0.0.1", () => console.log(`Toolkit website: http://127.0.0.1:${port}${base}`));
