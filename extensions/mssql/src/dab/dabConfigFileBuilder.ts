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
    description?: string;
    source: {
        type: string;
        object: string;
        description?: string;
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
    mcp?: boolean | { "custom-tool"?: boolean; "dml-tools"?: boolean };
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
        include?: string[];
        exclude?: string[];
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
            if (!entity.isSupported || !Dab.isEntityExposed(entity)) {
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
            isRestEnabled && Dab.isEntityRestEnabled(entity)
                ? this.buildRestProperty(entity)
                : false;
        const graphqlConfig =
            isGraphQLEnabled && Dab.isEntityGraphQLEnabled(entity)
                ? this.buildGraphQLProperty(entity)
                : false;
        const description = entity.advancedSettings.description?.trim();
        const output: DabEntityOutput = {
            ...(description ? { description } : {}),
            source: {
                type: entity.sourceType ?? Dab.EntitySourceType.Table,
                object: `${entity.schemaName}.${entity.sourceName ?? entity.tableName}`,
                ...(description ? { description } : {}),
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

        const fields = this.buildFieldsProperty(entity);
        if (fields.length) {
            output.fields = fields.map((field) => ({
                name: field.name,
                ...(field.alias ? { alias: field.alias } : {}),
                ...(field.description ? { description: field.description } : {}),
                ...(field.isPrimaryKey ? { "primary-key": true } : {}),
            }));
        }

        if (isMcpEnabled) {
            output.mcp = this.buildMcpProperty(entity);
        }

        return output;
    }

    private buildFieldsProperty(entity: Dab.DabEntityConfig): Dab.DabFieldConfig[] {
        if (entity.sourceType === Dab.EntitySourceType.StoredProcedure) {
            return [];
        }

        if (entity.fields?.length) {
            const fieldsByName = new Map(
                entity.fields.map((field) => [Dab.normalizeDabIdentifier(field.name), field]),
            );
            return entity.columns.map((column) => {
                const field = fieldsByName.get(Dab.normalizeDabIdentifier(column.name));
                return {
                    name: column.name,
                    ...(field?.alias ? { alias: field.alias } : {}),
                    ...(field?.description ? { description: field.description } : {}),
                    ...((field?.isPrimaryKey ?? column.isPrimaryKey) ? { isPrimaryKey: true } : {}),
                };
            });
        }

        return entity.columns.map((column) => ({
            name: column.name,
            ...(column.isPrimaryKey ? { isPrimaryKey: true } : {}),
        }));
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
            ...(parameter.defaultValue !== undefined && parameter.defaultValue !== null
                ? { default: String(parameter.defaultValue) }
                : {}),
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
        const hiddenColumns = entity.columns
            .filter((column) => !column.isExposed && !Dab.isLogicalKeyColumn(entity, column))
            .map((column) => column.name);
        const allColumns = entity.columns.map((column) => column.name);

        return Dab.getEntityPermissions(entity)
            .filter((permission) => permission.actions.length > 0)
            .map((permission) => ({
                role: permission.role,
                actions: permission.actions.map((action) => {
                    const actionFieldAccess = permission.fieldAccess?.find(
                        (access) => access.action === action,
                    );
                    if (actionFieldAccess || permission.fieldAccess?.length) {
                        return {
                            action,
                            fields: {
                                include: [...(actionFieldAccess?.fields ?? allColumns)],
                            },
                        };
                    }

                    return hiddenColumns.length > 0 && action !== Dab.EntityAction.Delete
                        ? {
                              action,
                              fields: {
                                  exclude: [...hiddenColumns],
                              },
                          }
                        : action;
                }),
            }));
    }

    private buildMcpProperty(
        entity: Dab.DabEntityConfig,
    ): boolean | { "custom-tool"?: boolean; "dml-tools"?: boolean } {
        if (!Dab.isEntityMcpEnabled(entity)) {
            return false;
        }

        return {
            "dml-tools": Dab.isEntityMcpDmlToolsEnabled(entity),
            ...(entity.sourceType === Dab.EntitySourceType.StoredProcedure
                ? { "custom-tool": Dab.isEntityMcpCustomToolEnabled(entity) }
                : {}),
        };
    }
}
