# Push CollectQuiet to GitHub

**Your GitHub username:** `nimish14`  
**Repo name:** `collectquiet`  
**Local path:** `C:\Users\pande\Desktop\Run`

GitHub CLI: `C:\Program Files\GitHub CLI\gh.exe`  
**Remote configured:** `origin` → https://github.com/nimish14/collectquiet.git

---

## Current release state (2026-07-14)

| Tag | Commit | What's in it |
|-----|--------|--------------|
| **v1** | `b6770d9` | Pre-CSV production — rollback here if you dislike v2 |
| **v2** | `5f1207d` | CSV bulk import + **live prod** at https://collectquiet.vercel.app |

**Vercel prod deployment (v2):** `dpl_7BLrAUoxYe8VMjKYFkytuRdhiWW5`  
Rollback in Vercel: Deployments → previous deployment → **Promote to Production**, or redeploy git tag `v1`.

---

## Step 1 — Log in (device code, ~1 min)

Open **PowerShell** and run:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --skip-ssh-key
```

1. Copy the one-time code (e.g. `XXXX-XXXX`)
2. Open https://github.com/login/device
3. Paste code → **Authorize** GitHub CLI

Verify:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth status
```

---

## Step 2 — Create repo & push all history + tags (~30 sec)

```powershell
cd C:\Users\pande\Desktop\Run
& "C:\Program Files\GitHub CLI\gh.exe" repo create collectquiet --public --source=. --remote=origin --push
git push origin --tags
```

If the repo already exists:

```powershell
cd C:\Users\pande\Desktop\Run
git push -u origin main --tags
```

**Done.** Repo URL: https://github.com/nimish14/collectquiet

Optional — create GitHub Releases from tags:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" release create v1 --title "v1 — Freelancer app (no CSV)" --notes "Rollback baseline. Individual + Add invoice flow only."
& "C:\Program Files\GitHub CLI\gh.exe" release create v2 --title "v2 — CSV bulk import" --notes "Import CSV for agencies. Solo freelancer flow unchanged."
```

---

## Alternative — Personal Access Token (if device code fails)

1. Go to https://github.com/settings/tokens → **Generate new token (classic)**
2. Scope: **`repo`**
3. Run:

```powershell
# Paste token when prompted (input is hidden)
$token = Read-Host "Paste GitHub PAT"
$token | & "C:\Program Files\GitHub CLI\gh.exe" auth login --with-token
```

Then run Step 2 above.

---

## Alternative — SSH key (already generated)

A new SSH key was created on this machine. Add this public key at  
https://github.com/settings/keys → **New SSH key**:

```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDtTAGwTYXu6PkhjpBUs9OdvrP19NQ8tDcAseNwVUtur pandey.nimish11@gmail.com
```

Then:

```powershell
cd C:\Users\pande\Desktop\Run
git remote add origin git@github.com:nimish14/collectquiet.git
& "C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol ssh --skip-ssh-key
# Or create repo on https://github.com/new (name: collectquiet, no README)
git push -u origin main
```

---

## What's already committed

- Branch: `main` (4 commits)
- `.env` is **gitignored** — never commit it

## After push

Connect Vercel: import https://github.com/nimish14/collectquiet
