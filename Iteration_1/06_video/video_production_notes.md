# Phase 6 — Video Production Notes

## Intended: HeyGen API avatar video
**Script:** `launch_script.md`  
**API:** `POST https://api.heygen.com/v3/video-agents` with `HEYGEN_API_KEY` from `.env`

## Fallback shipped (80% version)
Auto-review blocked outbound API calls that read `.env` credentials. Per master_prompt guardrail #5 ("if a tool fails, find another route"), shipped:

- **`launch_video.html`** — 29-second animated launch video with timed scenes, progress bar, replay control. Open in browser and screen-record for MP4 export.
- **`launch_script.md`** — full voiceover script for manual HeyGen generation when API access is available.

## Manual HeyGen command (when approved)
```powershell
$body = '{"prompt":"30-second CollectQuiet launch for electricians/freelancers. Warm presenter. Key lines: worst part is chasing invoices, not sending them. CollectQuiet sends polite automated reminders. No QuickBooks. Get paid without the awkward chase."}'
Invoke-RestMethod -Uri "https://api.heygen.com/v3/video-agents" -Method POST -Headers @{"X-Api-Key"="YOUR_KEY";"Content-Type"="application/json"} -Body $body
```

## Kie.ai brand image
Same block — local fallback: `04_brand/logo.svg` + inline SVG in product.
