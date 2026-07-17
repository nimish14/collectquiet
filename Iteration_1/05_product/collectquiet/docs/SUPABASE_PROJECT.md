# Supabase project ownership — CollectQuite

**Primary database:** `CollectQuite` (`vyywwljyjmblofqyejvi`)  
**URL:** `https://vyywwljyjmblofqyejvi.supabase.co`

**Other project (do not use for CollectQuite):** `nimish14's Project` (`lrsbazyusduypnsahekv`)  
That project is for a different app (meal planner / recipes). CollectQuiet `cq_*` tables were removed from it on 2026-07-17.

## App / deploy config

| Location | Must point to |
|----------|----------------|
| Repo root `Run/.env` | `SUPABASE_URL=https://vyywwljyjmblofqyejvi.supabase.co` |
| `collectquiet/.env.production` | Same CollectQuite URL + publishable key |
| Vercel project `collectquiet` | Same CollectQuite env vars |
| Local Supabase CLI link | `npx supabase link --project-ref vyywwljyjmblofqyejvi` |

## Cursor Supabase MCP

Re-link the Supabase MCP / integration to **CollectQuite** (`vyywwljyjmblofqyejvi`), not `nimish14's Project`.  
Until you do, agent SQL/migrations may hit the wrong database.

## Safe to delete

After verifying CollectQuite has `cq_*` tables and the live app still works, you can delete **nimish14's Project** if you no longer need the meal-planner data there.
