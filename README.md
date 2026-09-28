# Family Finance OS (ffos)

Mobile-first PWA for tracking family income and expenses in **shareable books** with role-based access.
See [PLAN.md](PLAN.md) for the full product plan.

```
shared/  Zod schemas, types, role→permission map (used by both sides)
api/     Hono API → Vercel serverless function, MongoDB driver
web/     React + Vite + Tailwind PWA → GitHub Pages
```

## Run locally

Requirements: Node 22+, a MongoDB (local `mongod` or an Atlas connection string).

```bash
npm install
cp api/.env.example api/.env     # set MONGODB_URI and a long random JWT_SECRET
cp web/.env.example web/.env     # VITE_API_URL=http://localhost:8787
npm run dev                      # API on :8787, web on :5173
```

Open http://localhost:5173. The first visit shows the one-time **setup** screen that creates the owner account.

```bash
npm test          # API integration tests (in-memory MongoDB)
npm run typecheck
```

## Deploy

### 1. MongoDB Atlas (free M0)
1. Create an M0 cluster, then a database user with **readWrite on `ffos` only**.
2. Network Access → allow `0.0.0.0/0` (serverless functions have no fixed IP).
3. Copy the `mongodb+srv://…` connection string.

### 2. API on Vercel (free Hobby)
1. Import the GitHub repo in Vercel and set **Root Directory = `api`**.
2. Environment variables:
   | Name | Value |
   |---|---|
   | `MONGODB_URI` | Atlas connection string |
   | `MONGODB_DB` | `ffos` |
   | `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` |
   | `CORS_ORIGINS` | `https://<github-user>.github.io` |
3. Deploy, then check `https://<project>.vercel.app/api/health` returns `{"ok":true}`.

### 3. Web on GitHub Pages
1. Repo → Settings → Pages → Source: **GitHub Actions**.
2. Repo → Settings → Secrets and variables → Actions → **Variables** → `VITE_API_URL` = your Vercel URL.
3. Push to `main`; `.github/workflows/deploy-web.yml` builds and publishes to
   `https://<github-user>.github.io/<repo>/`.
4. On your phone, open that URL → browser menu → **Add to Home Screen / Install app**.

## Security notes
- Refresh tokens rotate on every use and are stored hashed; access tokens (15 min) live only in memory.
- Every book route checks membership and role on each request, so a role change or removal applies immediately.
- The refresh token is kept in `localStorage` so the installed app stays signed in. Anyone with access to the
  unlocked phone has access to the app; an app-lock PIN/biometric is planned (PLAN.md phase 7).
