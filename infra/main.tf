# Three Plates infrastructure, built to stay at $0:
#
#   - Static Web App (Free): hosts the app and the managed Functions API, with sign-in, SSL and PR previews.
#   - Cosmos DB (free tier): household sync. A hard account-wide cap of 1000 RU/s means extra traffic is
#     throttled, never billed.
#   - Application Insights + Log Analytics: API telemetry, with daily ingestion caps inside the free allowance.
#   - A $1 monthly budget on the resource group: emails you if anything ever starts to cost money.

data "azurerm_client_config" "current" {}

locals {
  tags = {
    app  = "three-plates"
    cost = "free"
  }
  # Cosmos account names are global, so add a short suffix that's stable for this subscription and resource group.
  suffix              = substr(sha1("${data.azurerm_client_config.current.subscription_id}/${var.resource_group_name}"), 0, 6)
  cosmos_account_name = coalesce(var.cosmos_account_name, "cosmos-${var.site_name}-${local.suffix}")
}

resource "azurerm_resource_group" "main" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}

# ---------- Cosmos DB ----------

resource "azurerm_cosmosdb_account" "main" {
  name                = local.cosmos_account_name
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  offer_type          = "Standard"
  kind                = "GlobalDocumentDB"

  # One free-tier account per subscription: the first 1000 RU/s and 25 GB are free.
  free_tier_enabled = var.cosmos_free_tier

  # Hard ceiling on provisioned throughput across the whole account, so it can never exceed the free amount.
  capacity {
    total_throughput_limit = 1000
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = azurerm_resource_group.main.location
    failover_priority = 0
  }

  # Default periodic backups, kept in locally redundant storage.
  backup {
    type                = "Periodic"
    interval_in_minutes = 240
    retention_in_hours  = 8
    storage_redundancy  = "Local"
  }

  minimal_tls_version = "Tls12"
  tags                = local.tags
}

# Shared throughput: all containers draw from the database's 1000 RU/s.
resource "azurerm_cosmosdb_sql_database" "main" {
  name                = "threeplates"
  resource_group_name = azurerm_resource_group.main.name
  account_name        = azurerm_cosmosdb_account.main.name
  throughput          = 1000
}

# One partition per household: its meta item plus every synced document. Tombstones expire via per-item TTL.
resource "azurerm_cosmosdb_sql_container" "households" {
  name                  = "households"
  resource_group_name   = azurerm_resource_group.main.name
  account_name          = azurerm_cosmosdb_account.main.name
  database_name         = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths   = ["/householdId"]
  partition_key_version = 2
  default_ttl           = -1 # TTL on, but only for items that set their own

  indexing_policy {
    indexing_mode = "consistent"
    included_path {
      path = "/*"
    }
    # Document bodies are never queried, so skip indexing them to save RUs on every write.
    excluded_path {
      path = "/data/*"
    }
  }
}

# Point reads only (user id -> household), so index nothing.
resource "azurerm_cosmosdb_sql_container" "users" {
  name                  = "users"
  resource_group_name   = azurerm_resource_group.main.name
  account_name          = azurerm_cosmosdb_account.main.name
  database_name         = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths   = ["/id"]
  partition_key_version = 2

  indexing_policy {
    indexing_mode = "consistent"
    excluded_path {
      path = "/*"
    }
  }
}

# Invite codes delete themselves after 7 days.
resource "azurerm_cosmosdb_sql_container" "invites" {
  name                  = "invites"
  resource_group_name   = azurerm_resource_group.main.name
  account_name          = azurerm_cosmosdb_account.main.name
  database_name         = azurerm_cosmosdb_sql_database.main.name
  partition_key_paths   = ["/id"]
  partition_key_version = 2
  default_ttl           = 7 * 24 * 60 * 60

  indexing_policy {
    indexing_mode = "consistent"
    excluded_path {
      path = "/*"
    }
  }
}

# ---------- Monitoring ----------

resource "azurerm_log_analytics_workspace" "main" {
  count               = var.enable_monitoring ? 1 : 0
  name                = "log-${var.site_name}"
  location            = azurerm_resource_group.main.location
  resource_group_name = azurerm_resource_group.main.name
  sku                 = "PerGB2018"
  retention_in_days   = 30
  daily_quota_gb      = var.log_daily_cap_gb # ~3 GB/month at 0.1, under the 5 GB free monthly allowance
  tags                = local.tags
}

resource "azurerm_application_insights" "main" {
  count                = var.enable_monitoring ? 1 : 0
  name                 = "appi-${var.site_name}"
  location             = azurerm_resource_group.main.location
  resource_group_name  = azurerm_resource_group.main.name
  workspace_id         = azurerm_log_analytics_workspace.main[0].id
  application_type     = "web"
  daily_data_cap_in_gb = var.log_daily_cap_gb
  tags                 = local.tags
}

# ---------- Static Web App ----------

resource "azurerm_static_web_app" "site" {
  name                = var.site_name
  resource_group_name = azurerm_resource_group.main.name
  location            = azurerm_resource_group.main.location
  sku_tier            = "Free"
  sku_size            = "Free"

  # Deploys come from GitHub Actions using the deployment token, so no repository link here.
  preview_environments_enabled       = true
  configuration_file_changes_enabled = true

  # Settings for the managed Functions API. Managed functions can't use a managed identity,
  # so the API connects with the Cosmos connection string.
  app_settings = merge(
    {
      COSMOS_CONNECTION_STRING = azurerm_cosmosdb_account.main.primary_sql_connection_string
      COSMOS_DATABASE          = azurerm_cosmosdb_sql_database.main.name
    },
    var.enable_monitoring ? { APPLICATIONINSIGHTS_CONNECTION_STRING = azurerm_application_insights.main[0].connection_string } : {}
  )

  tags = local.tags
}

# ---------- Cost guardrail ----------

resource "azurerm_consumption_budget_resource_group" "guardrail" {
  name              = "${var.site_name}-guardrail"
  resource_group_id = azurerm_resource_group.main.id
  amount            = var.budget_amount
  time_grain        = "Monthly"

  time_period {
    # Budgets must start on the first of a month.
    start_date = formatdate("YYYY-MM-01'T'00:00:00Z", timestamp())
  }

  notification {
    enabled        = true
    operator       = "GreaterThan"
    threshold      = 50
    threshold_type = "Actual"
    contact_emails = [var.contact_email]
  }

  notification {
    enabled        = true
    operator       = "GreaterThan"
    threshold      = 100
    threshold_type = "Forecasted"
    contact_emails = [var.contact_email]
  }

  lifecycle {
    # timestamp() changes on every run; keep the original start date.
    ignore_changes = [time_period]
  }
}
