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
    };
    runtime: DabRuntimeConfig;
    entities: Record<string, DabEntityOutput>;
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
        "key-fields"?: string[];
        parameters?: DabParameterOutput[];
    };
    fields?: Array<{
        name: string;
        alias?: string;
        description?: string;
        "primary-key"?: boolean;
    }>;
    rest: boolean | { path?: string; methods?: string[] } | undefined;
    graphql: boolean | { type?: DabGraphQLTypeOutput; operation?: string } | undefined;
    permissions: DabPermissionEntry[];
    mcp?: { "custom-tool"?: boolean; "dml-tools"?: boolean };
}

type DabGraphQLTypeOutput = string | { singular: string; plural?: string };

interface DabPermissionEntry {
    role: string;
    actions: Array<string | DabPermissionAction>;
}

interface DabParameterOutput {
    name: string;
    required?: boolean;
    default?: string | number | boolean | null;
    description?: string;
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
                config.apiTypes.includes(Dab.ApiType.Mcp),
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
        isMcpEnabled: boolean,
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
                isMcpEnabled,
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
        isMcpEnabled: boolean,
    ): DabEntityOutput {
        const restConfig =
            isRestEnabled && entity.advancedSettings.restEnabled !== false
                ? this.buildRestProperty(entity)
                : false;
        const graphqlConfig =
            isGraphQLEnabled && entity.advancedSettings.graphQLEnabled !== false
                ? this.buildGraphQLProperty(entity)
                : false;
        const output: DabEntityOutput = {
            source: {
                type: entity.sourceType ?? Dab.EntitySourceType.Table,
                object: `${entity.schemaName}.${entity.sourceName ?? entity.tableName}`,
                ...this.buildKeyFieldsProperty(entity),
                ...(entity.sourceType === Dab.EntitySourceType.StoredProcedure &&
                entity.parameters?.length
                    ? {
                          parameters: entity.parameters.map((parameter) =>
                              this.buildParameterProperty(parameter),
                          ),
                      }
                    : {}),
            },
            rest: restConfig,
            graphql: graphqlConfig,
            permissions: this.buildPermissions(entity),
        };

        if (entity.fields?.length) {
            output.fields = entity.fields.map((field) => ({
                name: field.name,
                ...(field.alias ? { alias: field.alias } : {}),
                ...(field.description ? { description: field.description } : {}),
                ...(field.isPrimaryKey ? { "primary-key": true } : {}),
            }));
        }

        if (
            isMcpEnabled &&
            entity.sourceType === Dab.EntitySourceType.StoredProcedure &&
            entity.advancedSettings.exposeAsMcpCustomTool !== false
        ) {
            output.mcp = {
                "custom-tool": true,
                "dml-tools": false,
            };
        }

        return output;
    }

    private buildKeyFieldsProperty(entity: Dab.DabEntityConfig): { "key-fields"?: string[] } {
        if (entity.sourceType === Dab.EntitySourceType.StoredProcedure || entity.fields?.length) {
            return {};
        }

        const keyFields = entity.columns
            .filter((column) => column.isPrimaryKey)
            .map((column) => column.name);

        return keyFields.length > 0 ? { "key-fields": keyFields } : {};
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
        const customPath = entity.advancedSettings.customRestPath;
        const restMethods =
            entity.sourceType === Dab.EntitySourceType.StoredProcedure
                ? this.getStoredProcedureRestMethod(
                      entity.advancedSettings.storedProcedureRestMethods,
                  )
                : undefined;
        const restConfig: { path?: string; methods?: string[] } = {};
        if (customPath) {
            restConfig.path = customPath.startsWith("/") ? customPath : `/${customPath}`;
        }
        if (restMethods?.length) {
            restConfig.methods = Dab.normalizeRestMethods(restMethods);
        }
        return Object.keys(restConfig).length > 0 ? restConfig : undefined;
    }

    private getStoredProcedureRestMethod(methods?: Dab.RestMethod[]): Dab.RestMethod[] {
        const method =
            methods?.find((configuredMethod) =>
                Dab.storedProcedureAllowedRestMethods.some(
                    (allowedMethod) => allowedMethod === configuredMethod,
                ),
            ) ?? Dab.RestMethod.Post;
        return [method];
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
    ): undefined | { type?: DabGraphQLTypeOutput; operation?: string } {
        const customType = this.buildGraphQLTypeProperty(entity.advancedSettings);
        const graphQLOperation =
            entity.sourceType === Dab.EntitySourceType.StoredProcedure
                ? entity.advancedSettings.storedProcedureGraphQLOperation
                : undefined;
        const graphqlConfig: { type?: DabGraphQLTypeOutput; operation?: string } = {};
        if (customType) {
            graphqlConfig.type = customType;
        }
        if (graphQLOperation) {
            graphqlConfig.operation = graphQLOperation;
        }
        return Object.keys(graphqlConfig).length > 0 ? graphqlConfig : undefined;
    }

    private buildGraphQLTypeProperty(
        settings: Dab.EntityAdvancedSettings,
    ): DabGraphQLTypeOutput | undefined {
        const singular = settings.customGraphQLSingularType ?? settings.customGraphQLType;
        const plural = settings.customGraphQLPluralType;

        if (!singular) {
            return undefined;
        }

        if (singular && !plural) {
            return singular;
        }

        return {
            singular,
            plural,
        };
    }

    private buildParameterProperty(parameter: Dab.DabParameterConfig): DabParameterOutput {
        return {
            name: parameter.name,
            ...(parameter.isRequired !== undefined ? { required: parameter.isRequired } : {}),
            ...(parameter.defaultValue !== undefined ? { default: parameter.defaultValue } : {}),
            ...(parameter.description ? { description: parameter.description } : {}),
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
                    actions: [Dab.EntityAction.Execute],
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
