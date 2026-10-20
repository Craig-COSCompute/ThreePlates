terraform {
  required_version = ">= 1.6"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

provider "azurerm" {
  features {}

  # azurerm 4.x needs a subscription. Set it here or with the ARM_SUBSCRIPTION_ID environment variable.
  subscription_id = var.subscription_id
}
