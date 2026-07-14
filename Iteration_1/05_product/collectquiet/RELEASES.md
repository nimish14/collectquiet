# CollectQuiet releases

| Tag | Description | Rollback |
|-----|-------------|----------|
| **v1** | Global freelancer app — individual `+ Add invoice`, no CSV import | Safe baseline |
| **v2** | v1 + **Import CSV** for agencies/businesses (bulk upload, preview, validate) | Current production target |

## Roll back to v1 on Vercel

1. Open [Vercel → collectquiet → Deployments](https://vercel.com/dashboard)
2. Find the deployment built from git tag/commit **v1** (or commit `b6770d9`)
3. **⋯** → **Promote to Production**

Or from CLI (in this folder):

```bash
git checkout v1
npx vercel --prod
git checkout main
```

## CSV import (v2)

Dashboard → **Import CSV** → download template → upload → fix any errors → confirm.

Columns: `client_name`, `client_email`, `client_phone`, `invoice_number`, `amount`, `issued_at`, `due_at`, `payment_link`, `notes` (aliases accepted).
