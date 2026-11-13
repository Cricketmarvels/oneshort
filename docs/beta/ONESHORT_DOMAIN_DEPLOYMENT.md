# OneShort on gofindr.in — getting the web app live on the domain

Date: 2026-11-10. Domain: **gofindr.in** (registered at GoDaddy).

## Why GoDaddy alone can't host it

OneShort is three parts: a static web app, a Python (FastAPI) API and a MongoDB database. GoDaddy's domain portfolio manages DNS records only, and GoDaddy's shared web hosting runs PHP/static sites, not FastAPI + MongoDB. So the domain must **point at a server that runs the API**. Two ways to get there:

| | Option A — Cloudflare tunnel to the current server (today, free) | Option B — real hosting (the beta environment) |
|---|---|---|
| What runs where | The Mac that already serves the demo keeps serving; Cloudflare gives it a fixed HTTPS name | API on a cloud host, MongoDB Atlas, media in object storage (`PLAYR_BETA_DEPLOYMENT_RUNBOOK.md`) |
| URL | `https://gofindr.in`, `https://www.gofindr.in`, Expo Go at `exps://expo.gofindr.in` | Same names, moved to the new host by changing DNS |
| Uptime | Only while the Mac is on and awake | Always on |
| Cost | ₹0 | ~US$0–25/month at beta scale (Atlas M0/M10, a small container, storage) |
| Good for | Testing features with friends this week | Real beta testers, TestFlight |

Do A now, B before inviting outside testers. Nothing about A is wasted: the same Cloudflare zone and DNS carry over to B.

## Status (2026-11-10)

Done through the owner's Cloudflare account (free plan, US$0):
- Zone `gofindr.in` created (id `6586c3f2…`), nameservers **merlin.ns.cloudflare.com** / **sierra.ns.cloudflare.com**; HTTPS enforced, Full SSL, TLS ≥ 1.2.
- `cloudflared` authorised on the Mac (browser approval); tunnel **`oneshort`** (`eb812615…`) created; proxied CNAMEs for `gofindr.in`, `www.gofindr.in`, `expo.gofindr.in` → the tunnel.
- `public-demo.sh` runs in named-tunnel mode (`.data/named-tunnel.env`).

Waiting on: the nameserver change at GoDaddy (zone status `pending` until then). Nothing in this setup costs money: Cloudflare Free plan, Cloudflare Tunnel is free, no paid add-ons enabled.

## Option A, step by step

**1. Put gofindr.in on Cloudflare (free plan).** Create an account at dash.cloudflare.com → Add a site → `gofindr.in` → Free. Cloudflare shows two nameservers (like `ada.ns.cloudflare.com`).

**2. Change nameservers at GoDaddy.** https://dcc.godaddy.com/control/portfolio → gofindr.in → DNS → Nameservers → *Change* → *I'll use my own nameservers* → paste the two Cloudflare names → Save. Propagation is usually under an hour, occasionally up to 24 h. Cloudflare emails when the zone is active.

**3. Authorise this Mac's `cloudflared` (browser approval, no secrets typed here).** In Terminal:
```
cloudflared tunnel login
```
A browser page opens; pick **gofindr.in**. This writes a certificate to `~/.cloudflared/cert.pem`. (If you'd rather I start it, say so: the command prints a link you open, like the Expo login.)

**4. Create the tunnel and DNS records, then start the app:**
```
cd ~/cricketmarvels/platform
scripts/cloudflare-setup.sh gofindr.in     # tunnel "oneshort", DNS for gofindr.in, www, expo
./public-demo.sh                            # now serves the fixed addresses
```
From then on `./public-demo.sh reload` ships code changes to the same addresses, and restarts never change the URL.

**5. Keep the Mac awake:** `caffeinate -dis` in a Terminal window while people test.

## Option B — real hosting

Follow `PLAYR_BETA_DEPLOYMENT_RUNBOOK.md`. The only DNS difference: the `gofindr.in` / `www` records point at the web host and `api.gofindr.in` at the API host instead of the tunnel. Needs your approval for the paid services.

## What changed in the app for the domain

- Name **OneShort**, tagline **"Your game, one tap away."** everywhere users see it (app, web title, share preview card, legal pages).
- iOS bundle id / Android package: **`in.gofindr.app`** (changed now, before any store record exists). Deep-link scheme `oneshort://`.
- Placeholder hosts in build profiles: `beta-api.gofindr.in`, `api.gofindr.in`.
- The Expo project slug stays `playr` under `playrrs-team` (dashboard name only; renaming would mean creating a second project). Tell me if you want it renamed too.
