/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";

const DAB_SCHEMA_URL =
    "https://github.com/Azure/data-api-builder/releases/latest/download/dab.draft.schema.json";

interface DabOutputConfig {
    $schema: string;
    "data-source": {
        "database-type": string;
        "connection-string": string;
        [key: string]: unknown;
    };
    runtime?: DabRuntimeConfig | Record<string, unknown>;
    entities: Record<string, DabEntityOutput>;
    [key: string]: unknown;
}

/**
 * Represents the runtime section of the DAB configuration file.
 * https://learn.microsoft.com/en-us/azure/data-api-builder/configuration/runtime#runtime
 */
interface DabRuntimeConfig {
    rest: { enabled: boolean; path: string };
    graphql: { enabled: boolean; path: string };
    mcp: { enabled: boolean };
    host: {
        mode: string;
        cors: { origins: string[] };
    };
}

/**
 * Represents the Entities section of the DAB configuration file.
 * https://learn.microsoft.com/en-us/azure/data-api-builder/configuration/entities#entities
 */
interface DabEntityOutput {
    description?: string;
    source:
        | string
        | {
              type: string;
              object: string;
              parameters?: Dab.StoredProcedureParameter[];
              "key-fields"?: string[];
          };
    fields?: Array<{
        name: string;
        alias?: string;
        description?: string;
        "primary-key"?: boolean;
    }>;
    rest: boolean | { path?: string; methods?: string[]; enabled?: boolean } | undefined;
    graphql:
        | boolean
        | {
              type?: string | { singular?: string; plural?: string };
              operation?: string;
              enabled?: boolean;
          }
        | undefined;
    mcp?: boolean | { "dml-tools"?: boolean; "custom-tool"?: boolean };
    permissions: DabPermissionEntry[];
}

interface DabPermissionEntry {
    role: string;
    actions: Array<string | DabPermissionAction>;
}

interface DabPermissionAction {
    action: string;
    fields?: {
        exclude: string[];
    };
}

export class DabConfigFileBuilder {
    /**
     * Builds the DAB configuration file as a JSON string.
     *
     * @param config The DAB configuration.
     * @param connectionInfo The connection information for the database.
     * @returns The DAB configuration file as a JSON string.
     */
    public build(config: Dab.DabConfig, connectionInfo: Dab.DabConnectionInfo): string {
        const dabOutput = this.buildDabConfigFile(config, connectionInfo);
        return JSON.stringify(dabOutput, undefined, 2);
    }

    /**
     * Builds the DAB configuration file.
     *
     * @param config The DAB configuration.
     * @param connectionInfo The connection information for the database.
     * @returns The DAB configuration file as a JSON object.
     */
    private buildDabConfigFile(
        config: Dab.DabConfig,
        connectionInfo: Dab.DabConnectionInfo,
    ): DabOutputConfig {
        if (config.fullConfig) {
            return this.buildFromFullConfig(config.fullConfig, connectionInfo);
        }

        return {
            $schema: DAB_SCHEMA_URL,
            "data-source": {
                "database-type": "mssql",
                "connection-string": connectionInfo.connectionString,
            },
            runtime: this.buildRuntimeSection(config.apiTypes),
            entities: this.buildEntitiesSection(
                config.entities,
                config.apiTypes.includes(Dab.ApiType.Rest),
                config.apiTypes.includes(Dab.ApiType.GraphQL),
            ),
        };
    }

    private buildFromFullConfig(
        fullConfig: Record<string, unknown>,
        connectionInfo: Dab.DabConnectionInfo,
    ): DabOutputConfig {
        const output = JSON.parse(JSON.stringify(fullConfig)) as DabOutputConfig;
        output.$schema = typeof output.$schema === "string" ? output.$schema : DAB_SCHEMA_URL;
        const dataSource =
            output["data-source"] && typeof output["data-source"] === "object"
                ? output["data-source"]
                : {};
        output["data-source"] = {
            ...dataSource,
            "database-type":
                typeof dataSource["database-type"] === "string"
                    ? dataSource["database-type"]
                    : "mssql",
            "connection-string": connectionInfo.connectionString,
        };
        output.entities =
            output.entities && typeof output.entities === "object" ? output.entities : {};
        return output;
    }

    /**
     * Builds the runtime section of the DAB configuration.
     *
     * The paths for REST and GraphQL APIs are set to default values.
     * Mode is set to 'development'.
     * CORS is configured to allow all origins.
     *
     * @param apiTypes The API types to enable in the runtime section.
     * @returns The runtime configuration object.
     */
    private buildRuntimeSection(apiTypes: Dab.ApiType[]): DabRuntimeConfig {
        return {
            rest: {
                enabled: apiTypes.includes(Dab.ApiType.Rest),
                path: "/api",
            },
            graphql: {
                enabled: apiTypes.includes(Dab.ApiType.GraphQL),
                path: "/graphql",
            },
            mcp: {
                enabled: apiTypes.includes(Dab.ApiType.Mcp),
            },
            host: {
                mode: "development",
                cors: {
                    origins: ["*"],
                },
            },
        };
    }

    /**
     * Builds the entities section of the DAB configuration.
     *
     * Only entities that are enabled in the configuration are included.
     *
     * @param entities The list of entity configurations.
     * @param isRestEnabled Whether REST API is enabled.
     * @param isGraphQLEnabled Whether GraphQL API is enabled.
     * @returns A record of entity names to their corresponding output configurations.
     */
    private buildEntitiesSection(
        entities: Dab.DabEntityConfig[],
        isRestEnabled: boolean,
        isGraphQLEnabled: boolean,
    ): Record<string, DabEntityOutput> {
        const result: Record<string, DabEntityOutput> = {};
        for (const entity of entities) {
            if (!entity.isEnabled || !entity.isSupported) {
                continue;
            }
            result[entity.advancedSettings.entityName] = this.buildEntityEntry(
                entity,
                isRestEnabled,
                isGraphQLEnabled,
            );
        }
        return result;
    }

    /**
     * Builds the output configuration for a single entity.
     *
     * @param entity The entity configuration.
     * @returns The output configuration for the entity.
     */
    private buildEntityEntry(
        entity: Dab.DabEntityConfig,
        isRestEnabled: boolean,
        isGraphQLEnabled: boolean,
    ): DabEntityOutput {
        const restConfig = isRestEnabled ? this.buildRestProperty(entity) : false;
        const graphqlConfig = isGraphQLEnabled ? this.buildGraphQLProperty(entity) : false;
        return {
            source: {
                type: entity.sourceType ?? Dab.EntitySourceType.Table,
                object: `${entity.schemaName}.${entity.tableName}`,
                ...(entity.sourceType === Dab.EntitySourceType.StoredProcedure &&
                entity.parameters?.length
                    ? { parameters: entity.parameters }
                    : {}),
                ...(entity.sourceType === Dab.EntitySourceType.View && entity.keyFields?.length
                    ? { "key-fields": entity.keyFields }
                    : {}),
            },
            rest: restConfig,
            graphql: graphqlConfig,
            ...(entity.mcp ? { mcp: this.buildMcpProperty(entity) } : {}),
            permissions: this.buildPermissions(entity),
        };
    }

    /**
     * Builds the REST property for a single entity.
     *
     * If a custom REST path is specified in the advanced settings, it is used.
     *
     * @param entity The entity configuration.
     * @returns The REST property for the entity.
     */
    private buildRestProperty(
        entity: Dab.DabEntityConfig,
    ): undefined | { path?: string; methods?: string[] } {
        const restConfig: { path?: string; methods?: string[] } = {};
        const customPath = entity.advancedSettings.customRestPath;
        if (customPath) {
            restConfig.path = customPath.startsWith("/") ? customPath : `/${customPath}`;
        }
        if (
            entity.sourceType === Dab.EntitySourceType.StoredProcedure &&
            entity.restMethods?.length
        ) {
            restConfig.methods = [...entity.restMethods];
        }
        return Object.keys(restConfig).length > 0 ? restConfig : undefined;
    }

    /**
     * Builds the GraphQL property for a single entity.
     *
     * If a custom GraphQL type is specified in the advanced settings, it is used.
     *
     * @param entity The entity configuration.
     * @returns The GraphQL property for the entity.
     */
    private buildGraphQLProperty(
        entity: Dab.DabEntityConfig,
    ): undefined | { type?: string; operation?: string } {
        const graphqlConfig: { type?: string; operation?: string } = {};
        const customType = entity.advancedSettings.customGraphQLType;
        if (customType) {
            graphqlConfig.type = customType;
        }
        if (entity.sourceType === Dab.EntitySourceType.StoredProcedure && entity.graphQLOperation) {
            graphqlConfig.operation = entity.graphQLOperation;
        }
        return Object.keys(graphqlConfig).length > 0 ? graphqlConfig : undefined;
    }

    private buildMcpProperty(entity: Dab.DabEntityConfig): {
        "dml-tools"?: boolean;
        "custom-tool"?: boolean;
    } {
        return {
            ...(entity.mcp?.dmlTools !== undefined ? { "dml-tools": entity.mcp.dmlTools } : {}),
            ...(entity.mcp?.customTool !== undefined
                ? { "custom-tool": entity.mcp.customTool }
                : {}),
        };
    }

    /**
     * Builds the permissions for a single entity.
     *
     * @param entity The entity configuration.
     * @returns The permissions for the entity.
     */
    private buildPermissions(entity: Dab.DabEntityConfig): DabPermissionEntry[] {
        if (entity.sourceType === Dab.EntitySourceType.StoredProcedure) {
            return [
                {
                    role: entity.advancedSettings.authorizationRole,
                    actions: ["execute"],
                },
            ];
        }

        const hiddenColumns = entity.columns
            .filter((column) => !column.isExposed)
            .map((column) => column.name);

        return [
            {
                role: entity.advancedSettings.authorizationRole,
                actions: entity.enabledActions.map((action) =>
                    hiddenColumns.length > 0 && action !== Dab.EntityAction.Delete
                        ? {
                              action,
                              fields: {
                                  exclude: [...hiddenColumns],
                              },
                          }
                        : action,
                ),
            },
        ];
    }
}
