const http = require("http");

const PORT = process.env.PORT || 3001;
const SHARED_SECRET = process.env.RELAY_SECRET || "";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "application/rss+xml, application/xml, text/xml, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  // Health check
  if (req.url === "/" || req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }

  // Only GET /rss?url=...
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  if (parsed.pathname !== "/rss") {
    res.writeHead(404);
    return res.end("Not found");
  }

  // Auth check
  if (SHARED_SECRET) {
    const authHeader = req.headers["x-relay-key"] || "";
    if (authHeader !== SHARED_SECRET) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
  }

  const feedUrl = parsed.searchParams.get("url");
  if (!feedUrl || !feedUrl.startsWith("http")) {
    res.writeHead(400);
    return res.end("Missing or invalid ?url= parameter");
  }

  // Fetch the feed with browser headers
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const upstream = await fetch(feedUrl, {
      signal: controller.signal,
      headers: HEADERS,
      redirect: "follow",
    });

    if (!upstream.ok) {
      res.writeHead(upstream.status);
      return res.end(`Upstream returned ${upstream.status}`);
    }

    const body = await upstream.text();
    const ct = upstream.headers.get("content-type") || "application/xml";

    res.writeHead(200, {
      "Content-Type": ct,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=600",
    });
    res.end(body);
  } catch (err) {
    if (err.name === "AbortError") {
      res.writeHead(504);
      return res.end("Upstream timeout");
    }
    res.writeHead(502);
    res.end("Fetch failed");
  } finally {
    clearTimeout(timeout);
  }
});

server.listen(PORT, () => {
  console.log(`RSS relay listening on port ${PORT}`);
});
