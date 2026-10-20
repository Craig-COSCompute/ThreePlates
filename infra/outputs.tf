output "default_hostname" {
  description = "The site's *.azurestaticapps.net hostname."
  value       = azurerm_static_web_app.site.default_host_name
}

output "site_resource_id" {
  value = azurerm_static_web_app.site.id
}

output "deployment_token" {
  description = "Value for the AZURE_STATIC_WEB_APPS_API_TOKEN GitHub secret."
  value       = azurerm_static_web_app.site.api_key
  sensitive   = true
}

output "cosmos_account_name" {
  value = azurerm_cosmosdb_account.main.name
}

output "cosmos_connection_string" {
  description = "For api/local.settings.json when running the API locally."
  value       = azurerm_cosmosdb_account.main.primary_sql_connection_string
  sensitive   = true
}

output "app_insights_name" {
  value = var.enable_monitoring ? azurerm_application_insights.main[0].name : null
}
