import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".webp": "image/webp",
};

export async function startPreviewServer(root = process.cwd()) {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url || "/", "http://localhost").pathname,
      );
      if (pathname === "/favicon.ico") {
        response.writeHead(204, { "cache-control": "no-store" });
        response.end();
        return;
      }
      const previewPath =
        pathname === "/" || pathname === "/imprint-refinery"
          ? "tools/browser-fixtures/preview.html"
          : pathname;
      const candidate = normalize(join(root, previewPath));
      if (!candidate.startsWith(root)) throw new Error("invalid path");
      const info = await stat(candidate);
      const file = info.isDirectory()
        ? join(candidate, "index.html")
        : candidate;
      response.writeHead(200, {
        "content-type": mime[extname(file)] || "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(await readFile(file));
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

export const chromePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
