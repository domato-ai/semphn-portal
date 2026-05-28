// SEMPHN HNA Workbench — Phase 1 infrastructure.
//
// Provisions a fresh resource group with:
//   - Azure Static Web App (Free tier) — hosts the frontend + Managed Functions
//   - Application Insights — monitoring + Function logs
//   - Azure AI Services (Foundry) account + a gpt-4o-mini model deployment
//
// Deploy:
//   az deployment sub create --location australiaeast \
//     --template-file infra/main.bicep \
//     --parameters location=australiaeast
//
// After deploy, set SWA Application Settings (Azure portal → SWA → Configuration):
//   AZURE_FOUNDRY_ENDPOINT  — output 'foundryEndpoint' below
//   AZURE_FOUNDRY_KEY       — pull from Foundry → Keys (not exposed via Bicep output for safety)
//   MODEL_TIER              — 'mini' (or 'sonnet' once Sonnet deployment is added in Phase 2)
//
// Then add the GitHub Actions secret AZURE_STATIC_WEB_APPS_API_TOKEN
// (Azure portal → SWA → Overview → "Manage deployment token") to enable CI deploys.

targetScope = 'subscription'

@description('Azure region for all resources. Foundry has limited AU regions; falls back to eastus2 if needed.')
param location string = 'australiaeast'

@description('Resource group name.')
param rgName string = 'rg-semphn-portal'

@description('Prefix used for all child resource names.')
param namePrefix string = 'semphn-portal'

@description('GitHub repository URL — connect later via portal for CI deploys.')
param repoUrl string = 'https://github.com/domato-ai/semphn-portal'

// ────────────────────────────────────────────────────────────────────────────
// Resource group
// ────────────────────────────────────────────────────────────────────────────
resource rg 'Microsoft.Resources/resourceGroups@2024-03-01' = {
  name: rgName
  location: location
  tags: {
    project: 'semphn-portal'
    tenant: 'SEMPHN'
    owner: 'Domato AI'
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Child resources (Application Insights + SWA + Foundry)
// ────────────────────────────────────────────────────────────────────────────
module child 'main-children.bicep' = {
  scope: rg
  name: 'semphn-portal-children'
  params: {
    location: location
    namePrefix: namePrefix
    repoUrl: repoUrl
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────────────
output rgName string = rg.name
output swaName string = child.outputs.swaName
output swaDefaultHostname string = child.outputs.swaDefaultHostname
output foundryName string = child.outputs.foundryName
output foundryEndpoint string = child.outputs.foundryEndpoint
output appInsightsName string = child.outputs.appInsightsName
