variable "subscription_id" {
  description = "Azure subscription to deploy into. Leave null to use ARM_SUBSCRIPTION_ID."
  type        = string
  default     = null
}

variable "resource_group_name" {
  description = "Resource group that holds the site and the budget."
  type        = string
  default     = "rg-three-plates"
}

variable "site_name" {
  description = "Name of the Static Web App. Part of the default *.azurestaticapps.net hostname."
  type        = string
  default     = "three-plates"
}

variable "location" {
  description = "Region for the Static Web App resource. The site itself is served globally."
  type        = string
  default     = "centralus"

  validation {
    condition     = contains(["centralus", "eastus2", "westus2", "westeurope", "eastasia"], var.location)
    error_message = "Static Web Apps are available in centralus, eastus2, westus2, westeurope or eastasia."
  }
}

variable "contact_email" {
  description = "Email address for budget alerts."
  type        = string
}

variable "budget_amount" {
  description = "Monthly budget in your billing currency. Alerts fire on actual spend over 50% and forecast spend over 100%."
  type        = number
  default     = 1
}

variable "cosmos_account_name" {
  description = "Cosmos DB account name (globally unique). Leave null for cosmos-<site_name>-<suffix>."
  type        = string
  default     = null
}

variable "cosmos_free_tier" {
  description = "Use the Cosmos DB free tier. Only one account per subscription can have it; set false if yours is taken (that account would then bill)."
  type        = bool
  default     = true
}

variable "enable_monitoring" {
  description = "Create Application Insights and a Log Analytics workspace for the API."
  type        = bool
  default     = true
}

variable "log_daily_cap_gb" {
  description = "Daily ingestion cap for logs and telemetry, in GB. 0.1 keeps a month under the 5 GB free allowance."
  type        = number
  default     = 0.1
}
