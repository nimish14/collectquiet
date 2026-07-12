# CollectQuiet

**Get paid without the awkward chase.**

Invoice reminder tool for Indian freelancers and consultants. Log an invoice once, send polite → firm follow-ups via **email** or **WhatsApp**, with a full audit trail.

**Live app:** https://collectquiet.vercel.app

---

## Repository layout

```
Run/
├── .env.example              # Local secrets template (copy to .env — never commit)
├── master_prompt.md          # Original build mission
└── Iteration_1/
    ├── 01_research/          # Pain research dossiers
    ├── 02_tournament/        # Idea tournament + winner selection
    ├── 03_business/          # Business design
    ├── 04_brand/             # Brand guidelines + logo
    ├── 05_product/
    │   └── collectquiet/     # Vite + TypeScript web app (source)
    ├── 06_video/             # Launch video assets
    ├── 07_final/             # Package, architecture & business doc
    └── BUILD_LOG.md          # Decision log
```

## Quick start (local dev)

1. Copy environment template:
   ```bash
   cp .env.example .env
   ```
2. Add your Supabase **publishable** key and project URL to `.env`.
3. Run the app:
   ```bash
   cd Iteration_1/05_product/collectquiet
   npm install
   npm run dev
   ```
4. Open http://localhost:5173

## Supabase setup

1. Create a Supabase project.
2. Run `Iteration_1/05_product/collectquiet/supabase/schema.sql` in the SQL Editor.
3. Run `supabase/migration_freelancer.sql` for INR + phone columns.
4. Enable Email auth (Authentication → Providers).
5. Add your production URL to Auth redirect allowlist.

## Deploy

Built for Vercel. Set these environment variables at build time:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

See `Iteration_1/05_product/collectquiet/.env.production.example`.

## Documentation

| Doc | Path |
|-----|------|
| Architecture & business | `Iteration_1/07_final/ARCHITECTURE_AND_BUSINESS.md` |
| Final package | `Iteration_1/07_final/PACKAGE.md` |
| Product README | `Iteration_1/05_product/README.md` |

## Security

- Never commit `.env` or real API keys.
- Only the Supabase **publishable (anon)** key belongs in the frontend.
- Row Level Security isolates each user's data.

## License

Private / all rights reserved (update if you open-source).
