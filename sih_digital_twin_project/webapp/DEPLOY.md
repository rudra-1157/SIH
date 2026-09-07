# Deploying this to a live URL

I can't push this live myself — my sandbox only has network access to package
registries (PyPI, npm, GitHub) and no access to hosting platforms or your
accounts. Everything below is verified to build and run correctly (tested in
an isolated environment with the exact pinned `requirements.txt`); you just
need to push it and click deploy.

## 1. Push this folder to GitHub (required by every option below)

```bash
cd webapp
git init
git add .
git commit -m "Digital twin web app"
gh repo create uav-engine-digital-twin --public --source=. --push
# no gh CLI? create a repo at github.com/new, then:
#   git remote add origin https://github.com/<you>/uav-engine-digital-twin.git
#   git branch -M main && git push -u origin main
```

## 2. Deploy — pick one

**Render** (Docker-native, `render.yaml` included in this folder):
1. Go to dashboard.render.com → **New → Blueprint**
2. Connect the GitHub repo you just pushed
3. Render detects `render.yaml` and the `Dockerfile` automatically
4. Pick a plan when prompted (check render.com/pricing for current free/Hobby-tier
   availability — Render changed its pricing structure in April 2026, so I'm
   deliberately not promising a specific free tier will still be there)
5. Click **Deploy** → you get a `https://<name>.onrender.com` URL

**Railway** (usage-based billing, no blueprint needed):
1. railway.app → **New Project → Deploy from GitHub repo**
2. Select the repo — Railway auto-detects the `Dockerfile`
3. Railway sets `$PORT` automatically; nothing else to configure
4. Deploy → you get a `https://<name>.up.railway.app` URL

**Fly.io** (CLI-based, generous free allowance historically):
```bash
fly launch    # detects the Dockerfile, asks a few questions
fly deploy
```

All three read the same `Dockerfile` — you are not locked into one platform.

## 3. Verify it's live

```
curl https://<your-deployed-url>/api/health
# {"status":"ok"}
```
Then open the URL in a browser for the dashboard itself.

## Local run (no deployment, for testing right now)

```bash
cd webapp
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
# open http://localhost:8000
```
or with Docker:
```bash
docker build -t uav-twin .
docker run -p 8000:8000 uav-twin
```
