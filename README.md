# SEMPHN HNA Workbench

South Eastern Melbourne Primary Health Network — Health Needs Assessment workbench. A 13-step linear workflow that walks SEMPHN staff from sign-in through PPERS lodgement of their annual HNA update.

**Live deployment**: `https://semphn.domato.ai`
**Azure SWA hostname**: `https://ambitious-cliff-02027e900.7.azurestaticapps.net` (kept active as fallback)

The custom domain is wired to the Azure Static Web App via a CNAME on the
domato.ai zone (Wix DNS). To verify everything is healthy:

```bash
python scripts/check_custom_domain.py
```

Test scripts auto-pick the host (see `scripts/_portal_host.py`): they
prefer the custom domain when its TLS cert verifies, otherwise fall back
to the SWA hostname. Override with `PORTAL_HOST=https://...` if needed.

## What this is

The HNA Workbench is a tenant-only web app that:

1. Pulls SEMPHN's own catchment data (10 LGAs across South East Melbourne)
2. Organises it into the same 13-chapter structure DoH expects in the lodged HNA
3. Lets staff make decisions, write narrative, and chat with an AI assist on each step
4. Generates PPERS-ready artefacts (Word + PDF + CSV bundle + chart pack) at the final step
5. Hands off to `ppers.health.gov.au` for lodgement

Phase 1 surface = the 13-step workflow + chat assist. Phase 2+ adds document co-author, geospatial map tab, and dashboard builder.

## Architecture

| Layer | Tech | Why |
|---|---|---|
| Frontend | Static HTML + CSS + vanilla JS | No framework lock-in; SWA Free tier; sub-second cold-starts |
| Backend | Azure Static Web App Managed Functions (Python) | Free tier; co-located with frontend; no separate API surface |
| LLM | Azure AI Foundry · GPT-4o mini (default), Claude Sonnet 4.5 (Phase 2) | Data residency in Azure; one bill; hot-swap via `MODEL_TIER` env |
| State | localStorage (Phase 1 mock) | Real backend session deferred to Phase 1.5 |
| Infra | Bicep | Reproducible RG provision in `rg-semphn-portal` (Australia East) |
| CI/CD | GitHub Actions + `Azure/static-web-apps-deploy@v1` | Push to main = auto-deploy |

## Repo layout

```
semphn-portal/
├── README.md
├── .gitignore
├── .github/workflows/azure-static-web-apps.yml
├── api/                                  # SWA Managed Functions
│   ├── host.json
│   ├── requirements.txt
│   └── chat/
│       ├── function.json
│       └── __init__.py                   # POST /api/chat — Foundry-backed
├── site/                                 # SWA app_location
│   ├── index.html                        # Welcome (entry point)
│   ├── staticwebapp.config.json          # routes + nav fallback
│   ├── signin/index.html                 # email + password + code
│   └── atlas/                            # the 13-step workflow
│       ├── _assets/{shell.css, shell.js, semphn-logo.svg}
│       ├── data.json                     # placeholder SEMPHN data
│       ├── 01-introduction/index.html
│       ├── 02-region/index.html
│       ├── …
│       └── 13-lodgement/index.html
└── infra/main.bicep                      # SWA + Foundry workspace + model deploy
```

## Local development

```bash
# Serve site/ on localhost:8765
python -m http.server 8765 --directory site --bind 127.0.0.1
```

Open `http://localhost:8765/signin/`, enter any email + password + code (Phase 1 mock auth), land on `/atlas/`. Chat assist falls back to canned replies when the SWA Function isn't reachable (i.e. local dev without `swa start`).

For local backend + frontend with the chat Function:

```bash
npm install -g @azure/static-web-apps-cli
swa start site --api-location api
# Now at http://localhost:4280 — chat hits /api/chat through SWA CLI
```

## Deploy

Push to `main`. The GitHub Action provisions site + Functions to Azure SWA.

Required GitHub repo secret:
- `AZURE_STATIC_WEB_APPS_API_TOKEN` — created by Azure when the SWA resource is provisioned (Bicep deploy step)

Required Azure SWA Application Settings (set after first deploy via Azure portal or `az staticwebapp appsettings set`):
- `AZURE_FOUNDRY_ENDPOINT` — e.g. `https://aif-semphn-portal.<region>.inference.azure.com`
- `AZURE_FOUNDRY_KEY` — primary key from Foundry → Keys
- `MODEL_TIER` — `mini` (default) or `sonnet` to swap to Claude Sonnet 4.5

## Azure resources

Provisioned via `infra/main.bicep`:

| Resource | Name | Region | Purpose |
|---|---|---|---|
| Resource Group | `rg-semphn-portal` | australiaeast | container |
| Static Web App | `swa-semphn-portal` | australiaeast | frontend + Functions |
| Azure AI Services (Foundry) | `aif-semphn-portal` | australiaeast (or eastus2 if AU unavailable) | hosts model deployments |
| Model Deployment | `gpt-4o-mini` (pay-as-you-go) | within Foundry | Phase 1 chat |
| Application Insights | `appi-semphn-portal` | australiaeast | monitoring |

To provision:
```bash
export AZURE_CONFIG_DIR="C:/domato-abs/.azure"
az login --tenant 76130288-c8f5-4b4d-83ac-c7debbe28707
az deployment sub create --location australiaeast \
  --template-file infra/main.bicep \
  --parameters location=australiaeast
```

## Cost estimate

| Stage | Monthly all-in |
|---|---|
| Demo / pilot (light usage) | $25–$60 |
| SEMPHN production (Phase 1) | $100–$200 |
| Full product (Phase 1–4) | $300–$700 |

LLM cost dominates. Phase 1 with GPT-4o mini at production usage = ~$30–$80/mo. See `infra/main.bicep` comments for cost-control levers.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | 13-step workflow + chat assist | In build |
| 1.5 | Real backend auth (email + password + code via SWA Function) | Deferred |
| 2 | Document co-author with live preview | Planned |
| 3 | Geospatial map tab (LGA chloropleth + spatial chat) | Planned |
| 4 | Dashboard builder (drag-drop + AI chart-config generation) | Planned |

## Maintained by

Built by **Domato AI** · `support@domato.ai` · ABN 94 695 794 346

## Acknowledgement

We acknowledge the Bunurong and Wurundjeri peoples of the Kulin Nation, the Traditional Owners and Custodians of the lands, waters and skies in which SEMPHN works. We pay our respects to their Elders past and present. Sovereignty was never ceded.
