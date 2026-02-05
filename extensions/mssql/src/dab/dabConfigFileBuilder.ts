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
    source: { type: string; object: string };
    rest: boolean | { path: string };
    graphql: boolean | { type: string };
    permissions: DabPermissionEntry[];
}

interface DabPermissionEntry {
    role: string;
    actions: string[];
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
        return JSON.stringify(dabOutput, null, 2);
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
            if (!entity.isEnabled) {
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
        const restConfig = isRestEnabled ? this.buildRestProperty(entity) : undefined;
        const graphqlConfig = isGraphQLEnabled ? this.buildGraphQLProperty(entity) : undefined;
        return {
            source: {
                type: "table",
                object: `${entity.schemaName}.${entity.tableName}`,
            },
            rest: restConfig,
            graphql: graphqlConfig,
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
    private buildRestProperty(entity: Dab.DabEntityConfig): undefined | { path: string } {
        const customPath = entity.advancedSettings.customRestPath;
        if (customPath) {
            const path = customPath.startsWith("/") ? customPath : `/${customPath}`;
            return { path };
        }
        return undefined;
    }

    /**
     * Builds the GraphQL property for a single entity.
     *
     * If a custom GraphQL type is specified in the advanced settings, it is used.
     *
     * @param entity The entity configuration.
     * @returns The GraphQL property for the entity.
     */
    private buildGraphQLProperty(entity: Dab.DabEntityConfig): undefined | { type: string } {
        const customType = entity.advancedSettings.customGraphQLType;
        if (customType) {
            return { type: customType };
        }
        return undefined;
    }

    /**
     * Builds the permissions for a single entity.
     *
     * @param entity The entity configuration.
     * @returns The permissions for the entity.
     */
    private buildPermissions(entity: Dab.DabEntityConfig): DabPermissionEntry[] {
        return [
            {
                role: entity.advancedSettings.authorizationRole,
                actions: [...entity.enabledActions],
            },
        ];
    }
}
