/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Client-side generators for post-deployment infrastructure-as-code scripts
 * (Bicep, ARM template, and Terraform). These are produced from the wizard's
 * form values so users can reproduce the database they just provisioned.
 */

const DEFAULT_SKU_TIER = "GeneralPurpose";
const DEFAULT_SKU_FAMILY = "Gen5";
const DEFAULT_VCORES = "2";
const DEFAULT_COLLATION = "SQL_Latin1_General_CP1_CI_AS";
const DEFAULT_FREE_LIMIT_BEHAVIOR = "AutoPause";
const DEFAULT_MAX_SIZE_BYTES = 34359738368;
const DEFAULT_AUTO_PAUSE_DELAY = 60;
const DEFAULT_MIN_CAPACITY = 0.5;
const SQL_API_VERSION = "2023-08-01-preview";
const FABRIC_API_VERSION = "2024-11-01-preview";
const FABRIC_RESOURCE_TYPE = "Microsoft.Fabric/workspaces/sqlDatabases";

/** Mirrors VsCodeAzureHelper.createAzureSqlDatabase serverless SKU construction. */
const getServerlessSku = (maxVcores?: string) => {
    const vcores = maxVcores || DEFAULT_VCORES;
    return {
        name: `GP_S_${DEFAULT_SKU_FAMILY}_${vcores}`,
        tier: DEFAULT_SKU_TIER,
        family: DEFAULT_SKU_FAMILY,
        capacity: Number(vcores),
    };
};

const escapeBicepString = (value: string | undefined): string => (value ?? "").replace(/'/g, "\\'");

export interface AzureSqlDatabaseScriptParams {
    databaseName?: string;
    serverName?: string;
    collation?: string;
    /** Free-limit exhaustion behavior (e.g. "AutoPause" or "BillOverUsage"). */
    freeLimitBehavior?: string;
    /** Maximum vCores; drives the serverless SKU name and capacity. */
    maxVcores?: string;
    /** Subscription display name, used for informational header comments. */
    subscriptionName?: string;
    /** Resource group name, used for informational header comments. */
    resourceGroup?: string;
}

/**
 * Generates a Bicep template for an Azure SQL Database
 * (Microsoft.Sql/servers/databases) based on the provisioning form values.
 */
export function generateAzureSqlDatabaseBicep(params: AzureSqlDatabaseScriptParams): string {
    const databaseName = escapeBicepString(params.databaseName) || "mySqlDatabase";
    const serverName = escapeBicepString(params.serverName) || "mySqlServer";
    const collation = escapeBicepString(params.collation) || DEFAULT_COLLATION;
    const freeLimitBehavior =
        escapeBicepString(params.freeLimitBehavior) || DEFAULT_FREE_LIMIT_BEHAVIOR;
    const subscriptionName = escapeBicepString(params.subscriptionName) || "<subscription name>";
    const resourceGroup = escapeBicepString(params.resourceGroup) || "<resource group name>";
    const sku = getServerlessSku(params.maxVcores);

    return `// Azure SQL Database (Free Tier) — ${databaseName}
// Subscription: ${subscriptionName}
// Resource Group: ${resourceGroup}

resource sqlDatabase 'Microsoft.Sql/servers/databases@${SQL_API_VERSION}' = {
  name: '${serverName}/${databaseName}'
  location: resourceGroup().location
  sku: {
    name: '${sku.name}'
    tier: '${sku.tier}'
    family: '${sku.family}'
    capacity: ${sku.capacity}
  }
  properties: {
    collation: '${collation}'
    maxSizeBytes: ${DEFAULT_MAX_SIZE_BYTES}
    requestedBackupStorageRedundancy: 'Local'
    useFreeLimit: true
    freeLimitExhaustionBehavior: '${freeLimitBehavior}'
    autoPauseDelay: ${DEFAULT_AUTO_PAUSE_DELAY}
  }
}
`;
}

/**
 * Generates an ARM (Azure Resource Manager) JSON template for an Azure SQL
 * Database (Microsoft.Sql/servers/databases) based on the provisioning form values.
 */
export function generateAzureSqlDatabaseArm(params: AzureSqlDatabaseScriptParams): string {
    const databaseName = params.databaseName || "mySqlDatabase";
    const serverName = params.serverName || "mySqlServer";
    const collation = params.collation || DEFAULT_COLLATION;
    const freeLimitBehavior = params.freeLimitBehavior || DEFAULT_FREE_LIMIT_BEHAVIOR;
    const sku = getServerlessSku(params.maxVcores);

    const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        resources: [
            {
                type: "Microsoft.Sql/servers/databases",
                apiVersion: SQL_API_VERSION,
                name: `${serverName}/${databaseName}`,
                location: "[resourceGroup().location]",
                sku: {
                    name: sku.name,
                    tier: sku.tier,
                    family: sku.family,
                    capacity: sku.capacity,
                },
                properties: {
                    collation: collation,
                    maxSizeBytes: DEFAULT_MAX_SIZE_BYTES,
                    catalogCollation: collation,
                    zoneRedundant: false,
                    requestedBackupStorageRedundancy: "Local",
                    useFreeLimit: true,
                    freeLimitExhaustionBehavior: freeLimitBehavior,
                    autoPauseDelay: DEFAULT_AUTO_PAUSE_DELAY,
                    minCapacity: DEFAULT_MIN_CAPACITY,
                },
            },
        ],
    };

    return `${JSON.stringify(template, undefined, 2)}\n`;
}

/**
 * Generates a Terraform configuration (azurerm_mssql_database) for an Azure SQL
 * Database based on the provisioning form values.
 */
export function generateAzureSqlDatabaseTerraform(params: AzureSqlDatabaseScriptParams): string {
    const escapeHcl = (value: string | undefined): string => (value ?? "").replace(/"/g, '\\"');
    // Terraform resource/reference labels must be valid identifiers.
    const toTerraformId = (value: string | undefined, fallback: string): string => {
        const sanitized = (value ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        if (!sanitized) {
            return fallback;
        }
        return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
    };

    const databaseName = escapeHcl(params.databaseName) || "mySqlDatabase";
    const collation = escapeHcl(params.collation) || DEFAULT_COLLATION;
    const freeLimitBehavior = escapeHcl(params.freeLimitBehavior) || DEFAULT_FREE_LIMIT_BEHAVIOR;
    const subscriptionName = escapeHcl(params.subscriptionName) || "<subscription name>";
    const resourceGroup = escapeHcl(params.resourceGroup) || "<resource group name>";
    const sku = getServerlessSku(params.maxVcores);
    const databaseLabel = toTerraformId(params.databaseName, "this");
    const serverLabel = toTerraformId(params.serverName, "sql_server");

    return `# Azure SQL Database (Free Tier) — ${databaseName}
# Subscription: ${subscriptionName}
# Resource Group: ${resourceGroup}

resource "azurerm_mssql_database" "${databaseLabel}" {
  name      = "${databaseName}"
  server_id = azurerm_mssql_server.${serverLabel}.id

  collation      = "${collation}"
  max_size_gb    = ${DEFAULT_MAX_SIZE_BYTES / 1024 ** 3}
  sku_name       = "${sku.name}"
  zone_redundant = false

  storage_account_type = "Local"

  # Free-tier specific settings
  # use_free_limit = true
  # free_limit_exhaustion_behavior = "${freeLimitBehavior}"
}
`;
}

export interface FabricSqlDatabaseScriptParams {
    databaseName?: string;
    workspaceId?: string;
    /** Workspace display name, used for informational header comments. */
    workspaceName?: string;
    /** Tenant display name, used for informational header comments. */
    tenantName?: string;
}

/**
 * Generates a Bicep template for a SQL database in Microsoft Fabric
 * (Microsoft.Fabric) based on the provisioning form values.
 */
export function generateFabricSqlDatabaseBicep(params: FabricSqlDatabaseScriptParams): string {
    const databaseName = escapeBicepString(params.databaseName) || "mySqlDatabase";
    const workspaceId =
        escapeBicepString(params.workspaceId) || "00000000-0000-0000-0000-000000000000";
    const workspaceName = escapeBicepString(params.workspaceName) || "<workspace name>";
    const tenantName = escapeBicepString(params.tenantName) || "<tenant name>";

    return `// Microsoft Fabric SQL Database — ${databaseName}
// Tenant: ${tenantName}
// Workspace: ${workspaceName}

@description('The display name of the SQL database in Fabric.')
param databaseName string = '${databaseName}'

@description('The ID of the Fabric workspace that will host the database.')
param workspaceId string = '${workspaceId}'

resource fabricSqlDatabase '${FABRIC_RESOURCE_TYPE}@${FABRIC_API_VERSION}' = {
  name: '\${workspaceId}/\${databaseName}'
  properties: {
    displayName: databaseName
  }
}
`;
}

/**
 * Generates an ARM (Azure Resource Manager) JSON template for a Microsoft Fabric
 * SQL database (Microsoft.Fabric/workspaces/sqlDatabases) based on the
 * provisioning form values.
 */
export function generateFabricSqlDatabaseArm(params: FabricSqlDatabaseScriptParams): string {
    const databaseName = params.databaseName || "mySqlDatabase";
    const workspaceId = params.workspaceId || "00000000-0000-0000-0000-000000000000";

    const template = {
        $schema: "https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#",
        contentVersion: "1.0.0.0",
        parameters: {
            databaseName: {
                type: "string",
                defaultValue: databaseName,
                metadata: {
                    description: "The display name of the SQL database in Fabric.",
                },
            },
            workspaceId: {
                type: "string",
                defaultValue: workspaceId,
                metadata: {
                    description: "The ID of the Fabric workspace that will host the database.",
                },
            },
        },
        resources: [
            {
                type: FABRIC_RESOURCE_TYPE,
                apiVersion: FABRIC_API_VERSION,
                name: "[format('{0}/{1}', parameters('workspaceId'), parameters('databaseName'))]",
                properties: {
                    displayName: "[parameters('databaseName')]",
                },
            },
        ],
    };

    return `${JSON.stringify(template, undefined, 2)}\n`;
}

/**
 * Generates a Terraform configuration (azapi_resource) for a Microsoft Fabric
 * SQL database based on the provisioning form values. Fabric resources are
 * modeled through the AzAPI provider, which mirrors the ARM/Bicep resource type.
 */
export function generateFabricSqlDatabaseTerraform(params: FabricSqlDatabaseScriptParams): string {
    const escapeHcl = (value: string | undefined): string => (value ?? "").replace(/"/g, '\\"');
    // Terraform resource labels must be valid identifiers.
    const toTerraformId = (value: string | undefined, fallback: string): string => {
        const sanitized = (value ?? "").replace(/[^a-zA-Z0-9_]/g, "_");
        if (!sanitized) {
            return fallback;
        }
        return /^[0-9]/.test(sanitized) ? `_${sanitized}` : sanitized;
    };

    const databaseName = escapeHcl(params.databaseName) || "mySqlDatabase";
    const workspaceId = escapeHcl(params.workspaceId) || "00000000-0000-0000-0000-000000000000";
    const workspaceName = escapeHcl(params.workspaceName) || "<workspace name>";
    const tenantName = escapeHcl(params.tenantName) || "<tenant name>";
    const databaseLabel = toTerraformId(params.databaseName, "this");

    return `# Microsoft Fabric SQL Database — ${databaseName}
# Tenant: ${tenantName}
# Workspace: ${workspaceName}

resource "azapi_resource" "${databaseLabel}" {
  type      = "${FABRIC_RESOURCE_TYPE}@${FABRIC_API_VERSION}"
  name      = "${databaseName}"
  parent_id = "/workspaces/${workspaceId}"

  body = {
    properties = {
      displayName = "${databaseName}"
    }
  }
}
`;
}
