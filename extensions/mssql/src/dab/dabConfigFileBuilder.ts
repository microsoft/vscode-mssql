/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";
import { validateDabAdvancedJson } from "./dabAdvancedJsonValidation";

const DAB_SCHEMA_URL =
    "https://github.com/Azure/data-api-builder/releases/latest/download/dab.draft.schema.json";

interface DabOutputConfig {
    $schema: string;
    "data-source": {
        "database-type": string;
        "connection-string": string;
    };
    runtime: DabRuntimeConfig;
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
    source: {
        type: string;
        object: string;
        parameters?: Dab.DabStoredProcedureParameter[];
    };
    fields?: DabEntityFieldOutput[];
    rest: boolean | { path?: string; methods?: Dab.DabRestMethod[] } | undefined;
    graphql: boolean | { type?: string; operation?: Dab.DabGraphQLOperation } | undefined;
    mcp?: boolean | { "dml-tools"?: boolean; "custom-tool"?: boolean };
    permissions: DabPermissionEntry[];
    [key: string]: unknown;
}

interface DabEntityFieldOutput {
    name: string;
    "primary-key"?: boolean;
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

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeRecords<T extends Record<string, unknown>>(
    base: T,
    overlay: Record<string, unknown> | undefined,
): T {
    if (!overlay) {
        return base;
    }

    const result: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        const current = result[key];
        result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
    }
    return result as T;
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
        this.validateAdvancedJson(config);
        const dabOutput = this.buildDabConfigFile(config, connectionInfo);
        return JSON.stringify(dabOutput, undefined, 2);
    }

    private validateAdvancedJson(config: Dab.DabConfig): void {
        const topLevelError = validateDabAdvancedJson("top-level", config.advancedJson);
        if (topLevelError) {
            throw new Error(topLevelError);
        }

        for (const entity of config.entities) {
            const entityError = validateDabAdvancedJson("entity", entity.advancedJson);
            if (entityError) {
                throw new Error(`${entity.advancedSettings.entityName}: ${entityError}`);
            }
        }
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
        const advancedJson = config.advancedJson ?? {};
        const advancedDataSource = isRecord(advancedJson["data-source"])
            ? advancedJson["data-source"]
            : undefined;
        const advancedRuntime = isRecord(advancedJson.runtime) ? advancedJson.runtime : undefined;
        const advancedTopLevel = { ...advancedJson };
        delete advancedTopLevel["data-source"];
        delete advancedTopLevel.runtime;

        return {
            ...advancedTopLevel,
            $schema: DAB_SCHEMA_URL,
            "data-source": mergeRecords(
                {
                    "database-type": "mssql",
                    "connection-string": connectionInfo.connectionString,
                } as Record<string, unknown>,
                advancedDataSource,
            ) as DabOutputConfig["data-source"],
            runtime: mergeRecords(
                this.buildRuntimeSection(config.apiTypes) as unknown as Record<string, unknown>,
                advancedRuntime,
            ) as unknown as DabRuntimeConfig,
            entities: this.buildEntitiesSection(
                config.entities,
                config.apiTypes.includes(Dab.ApiType.Rest),
                config.apiTypes.includes(Dab.ApiType.GraphQL),
            ),
        };
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
        const sourceType = entity.sourceType ?? "table";
        const restConfig = isRestEnabled ? this.buildRestProperty(entity) : false;
        const graphqlConfig = isGraphQLEnabled ? this.buildGraphQLProperty(entity) : false;
        const advancedJson = entity.advancedJson ?? {};
        const advancedSource = isRecord(advancedJson.source) ? advancedJson.source : undefined;
        const advancedRest = isRecord(advancedJson.rest) ? advancedJson.rest : undefined;
        const advancedGraphQL = isRecord(advancedJson.graphql) ? advancedJson.graphql : undefined;
        const advancedMcp = isRecord(advancedJson.mcp) ? advancedJson.mcp : undefined;
        const advancedEntity = { ...advancedJson };
        delete advancedEntity.source;
        delete advancedEntity.rest;
        delete advancedEntity.graphql;
        delete advancedEntity.mcp;

        const generatedEntry: DabEntityOutput = {
            ...advancedEntity,
            source: {
                type: sourceType,
                object: `${entity.schemaName}.${entity.tableName}`,
                ...(sourceType === "stored-procedure" && entity.parameters?.length
                    ? { parameters: entity.parameters }
                    : {}),
            },
            ...(sourceType === "view" ? { fields: this.buildFieldsProperty(entity) } : {}),
            rest: restConfig,
            graphql: graphqlConfig,
            ...(sourceType === "stored-procedure" && entity.mcpCustomTool !== undefined
                ? {
                      mcp: {
                          "dml-tools": false,
                          "custom-tool": entity.mcpCustomTool,
                      },
                  }
                : {}),
            permissions: this.buildPermissions(entity),
        };

        generatedEntry.source = mergeRecords(generatedEntry.source, advancedSource);
        if (isRecord(generatedEntry.rest)) {
            generatedEntry.rest = mergeRecords(generatedEntry.rest, advancedRest);
        } else if (advancedRest) {
            generatedEntry.rest = mergeRecords({}, advancedRest);
        }
        if (isRecord(generatedEntry.graphql)) {
            generatedEntry.graphql = mergeRecords(generatedEntry.graphql, advancedGraphQL);
        } else if (advancedGraphQL) {
            generatedEntry.graphql = mergeRecords({}, advancedGraphQL);
        }
        if (isRecord(generatedEntry.mcp)) {
            generatedEntry.mcp = mergeRecords(generatedEntry.mcp, advancedMcp);
        } else if (advancedMcp) {
            generatedEntry.mcp = mergeRecords({}, advancedMcp);
        }

        return generatedEntry;
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
    ): undefined | { path?: string; methods?: Dab.DabRestMethod[] } {
        const customPath = entity.advancedSettings.customRestPath;
        const rest: { path?: string; methods?: Dab.DabRestMethod[] } = {};
        if (customPath) {
            rest.path = customPath.startsWith("/") ? customPath : `/${customPath}`;
        }
        if (entity.sourceType === "stored-procedure" && entity.restMethods?.length) {
            rest.methods = [...entity.restMethods];
        }
        return Object.keys(rest).length > 0 ? rest : undefined;
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
    ): undefined | { type?: string; operation?: Dab.DabGraphQLOperation } {
        const graphql: { type?: string; operation?: Dab.DabGraphQLOperation } = {};
        const customType = entity.advancedSettings.customGraphQLType;
        if (customType) {
            graphql.type = customType;
        }
        if (entity.sourceType === "stored-procedure" && entity.graphQLOperation) {
            graphql.operation = entity.graphQLOperation;
        }
        return Object.keys(graphql).length > 0 ? graphql : undefined;
    }

    private buildFieldsProperty(entity: Dab.DabEntityConfig): DabEntityFieldOutput[] {
        return entity.columns.map((column) => ({
            name: column.name,
            ...(column.isPrimaryKey ? { "primary-key": true } : {}),
        }));
    }

    /**
     * Builds the permissions for a single entity.
     *
     * @param entity The entity configuration.
     * @returns The permissions for the entity.
     */
    private buildPermissions(entity: Dab.DabEntityConfig): DabPermissionEntry[] {
        const hiddenColumns = entity.columns
            .filter((column) => !column.isExposed)
            .map((column) => column.name);

        return [
            {
                role: entity.advancedSettings.authorizationRole,
                actions: this.getPermissionActions(entity).map((action) =>
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

    private getPermissionActions(entity: Dab.DabEntityConfig): Dab.EntityAction[] {
        if (entity.sourceType === "stored-procedure") {
            return [Dab.EntityAction.Execute];
        }
        return entity.enabledActions;
    }
}
