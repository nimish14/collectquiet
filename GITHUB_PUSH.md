# Push CollectQuiet to GitHub

**Your GitHub username:** `nimish14`  
**Repo name:** `collectquiet`  
**Local path:** `C:\Users\pande\Desktop\Run`

GitHub CLI is installed at `C:\Program Files\GitHub CLI\gh.exe` (not on PATH).  
You are **not logged in** yet — complete Step 1 below in your own PowerShell window.

---

## Step 1 — Log in (device code, ~1 min)

Open **PowerShell** and run:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth login --hostname github.com --git-protocol https --skip-ssh-key
```

It will print something like:

```
! First copy your one-time code: XXXX-XXXX
Open this URL to continue in your web browser: https://github.com/login/device
```

1. Copy the code (e.g. `ACC8-803A`)
2. Open https://github.com/login/device in any browser
3. Paste the code → **Authorize** GitHub CLI

Verify:

```powershell
& "C:\Program Files\GitHub CLI\gh.exe" auth status
```

---

## Step 2 — Create repo & push (~30 sec)

```powershell
cd C:\Users\pande\Desktop\Run
& "C:\Program Files\GitHub CLI\gh.exe" repo create collectquiet --public --source=. --remote=origin --push
```

**Done.** Repo URL: https://github.com/nimish14/collectquiet

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
