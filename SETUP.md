# Setup guide (Phase 1: auth + channels + text chat)

## 1. Install Node.js
Download and install the LTS version from https://nodejs.org (v20 or later).
Verify: open a terminal/PowerShell and run `node -v`.

## 2. Install PostgreSQL on your PC
- Windows: download the installer from https://www.postgresql.org/download/windows/
- During install, set a password for the `postgres` superuser and remember it.
- After install, open "SQL Shell (psql)" from the Start menu (or `psql -U postgres` in a terminal).

Then run these commands inside psql:
```sql
CREATE DATABASE chatapp;
CREATE USER chatapp_user WITH ENCRYPTED PASSWORD 'choose_a_password';
GRANT ALL PRIVILEGES ON DATABASE chatapp TO chatapp_user;
\c chatapp
GRANT ALL ON SCHEMA public TO chatapp_user;
```

Now load the schema (from a normal terminal, in the `backend` folder):
```
psql -U chatapp_user -d chatapp -f schema.sql
```
(It will prompt for the password you set above.)

## 3. Configure the backend
In the `backend` folder:
```
cp .env.example .env
```
Edit `.env`:
- `DATABASE_URL` — use the username/password/db name from step 2, e.g.
  `postgresql://chatapp_user:choose_a_password@localhost:5432/chatapp`
- `JWT_SECRET` — generate one with `openssl rand -hex 32` (or any long random string)
- `CORS_ORIGIN` — your future GitHub Pages URL, e.g. `https://yourusername.github.io`
- Leave the `CF_*` lines blank for now (that's phase 2, voice chat)

Install dependencies and start the server:
```
cd backend
npm install
npm start
```
You should see `Server running on port 3000`. Leave this running — this is your always-on home server.

**Tip:** to keep it running in the background and auto-restart on crashes/reboots, install PM2:
```
npm install -g pm2
pm2 start server.js --name chat-backend
pm2 save
pm2 startup
```
(`pm2 startup` prints a command — run that command too, so it survives a PC reboot.)

## 4. Expose your backend with Cloudflare Tunnel (solves your CGNAT problem)
1. Create a free Cloudflare account at https://dash.cloudflare.com if you don't have one.
2. Install `cloudflared`:
   - Windows: download from https://github.com/cloudflare/cloudflared/releases (get the `.msi`)
3. Quick way to test (no domain needed), run:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   This prints a random URL like `https://random-words-1234.trycloudflare.com`. This is your backend's public address. It changes every time you restart this command, which is fine for testing but annoying long-term.
4. **For a permanent URL** (recommended once it's working): this needs a domain name you own connected to Cloudflare (domains are cheap, ~$10/year from Cloudflare Registrar or elsewhere). Once you have one:
   ```
   cloudflared tunnel login
   cloudflared tunnel create chat-backend
   cloudflared tunnel route dns chat-backend api.yourdomain.com
   cloudflared tunnel run chat-backend
   ```
   Then your backend is permanently reachable at `https://api.yourdomain.com`.
5. Also run cloudflared as a background service so it survives reboots — after the steps above, run:
   ```
   cloudflared service install
   ```

## 5. Configure and deploy the frontend
1. In `frontend/config.js`, set:
   ```js
   const API_BASE = 'https://api.yourdomain.com/api';   // or your trycloudflare.com URL + /api
   const WS_BASE = 'wss://api.yourdomain.com/ws';        // same host, wss:// and /ws
   ```
2. Create a new GitHub repo (or use an existing one).
3. Push the contents of the `frontend` folder to the repo (they must be at the repo root, or in a `/docs` folder — your choice).
4. In the repo: Settings → Pages → set "Source" to the branch/folder containing `index.html`. Save.
5. GitHub gives you a URL like `https://yourusername.github.io/reponame/` — that's your live site.
6. Go back to your backend `.env` and make sure `CORS_ORIGIN` exactly matches this URL, then restart the backend (`pm2 restart chat-backend`).

## 6. Test it
- Open your GitHub Pages URL on two different browsers (or one normal + one incognito window).
- Sign up as two different users.
- Create a channel with user A, join it with user B (public: click to join; private: share the invite code shown after creation).
- Send messages back and forth — they should appear instantly on both sides.

## What's next (Phase 2)
Voice chat via Cloudflare Realtime (free tier, no VPS needed) — I'll build the backend token-minting route and the frontend WebRTC wiring next. You'll need to create a free Cloudflare Realtime app (App ID + App Token) at that point — I'll walk you through exactly where to click when we get there.
