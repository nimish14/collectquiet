# Push to GitHub (manual)

GitHub CLI is installed but not logged in. The browser login window may not appear from the agent terminal — run these steps **in your own PowerShell**:

## Option A — Device code (recommended)

```powershell
gh auth login
```

When prompted, choose:
1. **GitHub.com**
2. **HTTPS**
3. **Login with a web browser** — if no browser opens, choose **Paste an authentication token** instead

If browser login fails, use a Personal Access Token:
1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Scope: `repo`
3. Run: `gh auth login --with-token` and paste the token

## Option B — Create repo on GitHub.com

1. Open https://github.com/new
2. Repository name: `collectquiet`
3. Public, **do not** add README (already committed locally)
4. Create repository, then run:

```powershell
cd C:\Users\pande\Desktop\Run
git remote add origin https://github.com/YOUR_USERNAME/collectquiet.git
git push -u origin main
```

Windows will prompt for GitHub login in a browser or credential dialog.

## Already committed locally

- Branch: `main`
- 60 files, secrets excluded (`.env` is gitignored)
- Never commit `Run/.env` — it contains private API keys

## After push

Repo URL: `https://github.com/YOUR_USERNAME/collectquiet`
