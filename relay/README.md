# RSS Feed Relay

Lightweight proxy that fetches RSS feeds from a non-AWS IP (Railway runs on GCP).
Many news sites block Vercel/AWS IPs but allow GCP.

## Deploy to Railway

1. Go to [railway.app](https://railway.app) and sign in with GitHub
2. Click **New Project → Deploy from GitHub repo**
3. Select this repo, set **Root Directory** to `relay`
4. Optionally add env var `RELAY_SECRET` for auth
5. Railway auto-detects Node.js and runs `npm start`
6. Copy the public URL (e.g. `https://worlddashboard-relay-production.up.railway.app`)
7. In your Vercel project, add env var:
   - `RELAY_URL` = the Railway URL
   - `RELAY_SECRET` = same value (if set)

## API

```
GET /rss?url=https://feeds.bbci.co.uk/news/world/rss.xml
Headers: x-relay-key: <RELAY_SECRET>  (if auth enabled)
```

Returns the raw RSS/XML body with 5-minute cache headers.

## Health Check

```
GET /health → { "status": "ok" }
```
