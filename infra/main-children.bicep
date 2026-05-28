// SEMPHN Portal — RG-scoped resources (Application Insights, Static Web App, AI Foundry).
//
// Called by main.bicep. Lives in its own file so the subscription-scoped parent can target
// the RG cleanly via a module.

@description('Azure region for all resources.')
param location string

@description('Prefix used for all resource names.')
param namePrefix string

@description('GitHub repository URL (set in SWA; connect to repo via portal later).')
param repoUrl string

// ────────────────────────────────────────────────────────────────────────────
// Application Insights (used by both SWA Functions + custom log queries)
// ────────────────────────────────────────────────────────────────────────────
resource lawWorkspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'law-${namePrefix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${namePrefix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: lawWorkspace.id
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Static Web App (Free tier — fits Phase 1 perfectly)
// ────────────────────────────────────────────────────────────────────────────
resource swa 'Microsoft.Web/staticSites@2024-04-01' = {
  name: 'swa-${namePrefix}'
  location: 'eastasia' // SWA only available in select regions; East Asia is closest to AU
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    // SWA preflight requires a non-empty repositoryUrl. The actual GH Actions
    // workflow is wired separately by setting AZURE_STATIC_WEB_APPS_API_TOKEN
    // as a repo secret (pulled from Azure portal → SWA → Manage deployment token).
    repositoryUrl: repoUrl
    branch: 'main'
    buildProperties: {
      appLocation: 'site'
      apiLocation: 'api'
      outputLocation: ''
    }
    provider: 'GitHub'
  }
  tags: {
    repoUrl: repoUrl
  }
}

// Application Insights wired into the SWA Functions
resource swaSettings 'Microsoft.Web/staticSites/config@2024-04-01' = {
  parent: swa
  name: 'appsettings'
  properties: {
    APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
    APPINSIGHTS_INSTRUMENTATIONKEY: appInsights.properties.InstrumentationKey
    // Foundry settings are populated after Foundry is provisioned + a model deployment exists.
    // Set via the portal after first deploy:
    //   AZURE_FOUNDRY_ENDPOINT
    //   AZURE_FOUNDRY_KEY
    //   MODEL_TIER (default 'mini')
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Azure AI Foundry (Cognitive Services account, kind = AIServices)
// Pay-as-you-go gpt-4o-mini deployment
// ────────────────────────────────────────────────────────────────────────────
resource foundry 'Microsoft.CognitiveServices/accounts@2024-10-01' = {
  name: 'aif-${namePrefix}'
  location: location
  sku: {
    name: 'S0'
  }
  kind: 'AIServices'
  properties: {
    customSubDomainName: 'aif-${namePrefix}'
    publicNetworkAccess: 'Enabled'
    networkAcls: {
      defaultAction: 'Allow'
    }
  }
}

// gpt-4o-mini deployment (Phase 1 default model)
resource gptMiniDeployment 'Microsoft.CognitiveServices/accounts/deployments@2024-10-01' = {
  parent: foundry
  name: 'gpt-4o-mini'
  sku: {
    name: 'GlobalStandard'  // PAYG; no provisioned throughput
    capacity: 100           // tokens per minute capacity (modest, suits Phase 1)
  }
  properties: {
    model: {
      format: 'OpenAI'
      name: 'gpt-4o-mini'
      version: '2024-07-18'
    }
    raiPolicyName: 'Microsoft.Default'
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Outputs
// ────────────────────────────────────────────────────────────────────────────
output swaName string = swa.name
output swaDefaultHostname string = swa.properties.defaultHostname
output foundryName string = foundry.name
output foundryEndpoint string = foundry.properties.endpoint
output appInsightsName string = appInsights.name
