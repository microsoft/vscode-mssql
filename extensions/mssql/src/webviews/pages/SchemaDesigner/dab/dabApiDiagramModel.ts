/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../../../../sharedInterfaces/dab";
import { pluralize } from "../../../../sharedInterfaces/pluralization";

export const DAB_REST_BASE_PATH = "/api";
export const DAB_GRAPHQL_BASE_PATH = "/graphql";
export const DAB_MCP_BASE_PATH = "/mcp";

export interface DabRestEndpoint {
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    path: string;
    operation: Dab.EntityAction | "readById";
}

export interface DabRestEntityDiagram {
    id: string;
    entityName: string;
    schemaName: string;
    tableName: string;
    basePath: string;
    endpoints: DabRestEndpoint[];
}

export interface DabGraphQLOperation {
    kind: "query" | "mutation";
    name: string;
    operation: Dab.EntityAction | "readById";
}

export interface DabGraphQLEntityDiagram {
    id: string;
    entityName: string;
    schemaName: string;
    tableName: string;
    singularName: string;
    pluralName: string;
    operations: DabGraphQLOperation[];
}

export interface DabMcpToolDiagram {
    name:
        | "describe_entities"
        | "read_records"
        | "create_record"
        | "update_record"
        | "delete_record"
        | "execute_entity";
    enabled: boolean;
}

export interface DabMcpEntityDiagram {
    id: string;
    entityName: string;
    schemaName: string;
    tableName: string;
    tools: DabMcpToolDiagram[];
}

export interface DabApiDiagramModel {
    rest: {
        enabled: boolean;
        basePath: string;
        entities: DabRestEntityDiagram[];
    };
    graphql: {
        enabled: boolean;
        basePath: string;
        entities: DabGraphQLEntityDiagram[];
    };
    mcp: {
        enabled: boolean;
        basePath: string;
        tools: DabMcpToolDiagram[];
        entities: DabMcpEntityDiagram[];
        enabledEntityCount: number;
        enabledActions: Dab.EntityAction[];
    };
}

function getEnabledEntities(config: Dab.DabConfig): Dab.DabEntityConfig[] {
    return config.entities.filter((entity) => entity.isEnabled && entity.isSupported);
}

function normalizeRestPath(path: string): string {
    return `/${path.replace(/^\/+/, "")}`;
}

function getEntityRestPath(entity: Dab.DabEntityConfig): string {
    const customPath = entity.advancedSettings.customRestPath?.trim();
    if (customPath) {
        return normalizeRestPath(customPath);
    }

    return normalizeRestPath(entity.advancedSettings.entityName);
}

function sanitizeGraphQLName(name: string): string[] {
    let sanitized = name;
    if (/^[^a-zA-Z]/.test(sanitized)) {
        sanitized = sanitized.slice(1);
    }

    sanitized = sanitized.replace(/[^a-zA-Z0-9_ ]/g, "");
    return sanitized.split(" ").filter((segment) => segment.length > 0);
}

function formatNameForGraphQLField(name: string): string {
    const segments = sanitizeGraphQLName(name);
    if (segments.length === 0) {
        return "";
    }

    return segments
        .map((segment, index) => {
            const firstChar = index === 0 ? segment[0].toLowerCase() : segment[0].toUpperCase();
            return `${firstChar}${segment.slice(1)}`;
        })
        .join("");
}

function getGraphQLSingularName(entity: Dab.DabEntityConfig): string {
    return entity.advancedSettings.customGraphQLType?.trim() || entity.advancedSettings.entityName;
}

function getGraphQLPluralName(entity: Dab.DabEntityConfig): string {
    return pluralize(getGraphQLSingularName(entity));
}

function hasAction(entity: Dab.DabEntityConfig, action: Dab.EntityAction): boolean {
    return entity.enabledActions.includes(action);
}

function createRestEndpoints(entity: Dab.DabEntityConfig): DabRestEndpoint[] {
    const basePath = getEntityRestPath(entity);
    const byIdPath = `${basePath}/id/{id}`;
    const endpoints: DabRestEndpoint[] = [];

    if (hasAction(entity, Dab.EntityAction.Read)) {
        endpoints.push(
            { method: "GET", path: basePath, operation: Dab.EntityAction.Read },
            { method: "GET", path: byIdPath, operation: "readById" },
        );
    }

    if (hasAction(entity, Dab.EntityAction.Create)) {
        endpoints.push({ method: "POST", path: basePath, operation: Dab.EntityAction.Create });
    }

    if (hasAction(entity, Dab.EntityAction.Update)) {
        endpoints.push(
            { method: "PUT", path: byIdPath, operation: Dab.EntityAction.Update },
            { method: "PATCH", path: byIdPath, operation: Dab.EntityAction.Update },
        );
    }

    if (hasAction(entity, Dab.EntityAction.Delete)) {
        endpoints.push({ method: "DELETE", path: byIdPath, operation: Dab.EntityAction.Delete });
    }

    return endpoints;
}

function createGraphQLOperations(entity: Dab.DabEntityConfig): DabGraphQLOperation[] {
    const singularName = getGraphQLSingularName(entity);
    const pluralName = getGraphQLPluralName(entity);
    const operations: DabGraphQLOperation[] = [];

    if (hasAction(entity, Dab.EntityAction.Read)) {
        operations.push(
            {
                kind: "query",
                name: formatNameForGraphQLField(pluralName),
                operation: Dab.EntityAction.Read,
            },
            {
                kind: "query",
                name: `${formatNameForGraphQLField(singularName)}_by_pk`,
                operation: "readById",
            },
        );
    }

    if (hasAction(entity, Dab.EntityAction.Create)) {
        operations.push({
            kind: "mutation",
            name: `create${singularName}`,
            operation: Dab.EntityAction.Create,
        });
    }

    if (hasAction(entity, Dab.EntityAction.Update)) {
        operations.push({
            kind: "mutation",
            name: `update${singularName}`,
            operation: Dab.EntityAction.Update,
        });
    }

    if (hasAction(entity, Dab.EntityAction.Delete)) {
        operations.push({
            kind: "mutation",
            name: `delete${singularName}`,
            operation: Dab.EntityAction.Delete,
        });
    }

    return operations;
}

function createMcpToolsForEntity(entity: Dab.DabEntityConfig): DabMcpToolDiagram[] {
    return [
        { name: "describe_entities", enabled: true },
        { name: "read_records", enabled: hasAction(entity, Dab.EntityAction.Read) },
        { name: "create_record", enabled: hasAction(entity, Dab.EntityAction.Create) },
        { name: "update_record", enabled: hasAction(entity, Dab.EntityAction.Update) },
        { name: "delete_record", enabled: hasAction(entity, Dab.EntityAction.Delete) },
        { name: "execute_entity", enabled: false },
    ];
}

export function createDabApiDiagramModel(config: Dab.DabConfig): DabApiDiagramModel {
    const enabledEntities = getEnabledEntities(config);
    const enabledActions = [
        Dab.EntityAction.Read,
        Dab.EntityAction.Create,
        Dab.EntityAction.Update,
        Dab.EntityAction.Delete,
    ].filter((action) => enabledEntities.some((entity) => hasAction(entity, action)));

    return {
        rest: {
            enabled: config.apiTypes.includes(Dab.ApiType.Rest),
            basePath: DAB_REST_BASE_PATH,
            entities: enabledEntities.map((entity) => ({
                id: entity.id,
                entityName: entity.advancedSettings.entityName,
                schemaName: entity.schemaName,
                tableName: entity.tableName,
                basePath: getEntityRestPath(entity),
                endpoints: createRestEndpoints(entity),
            })),
        },
        graphql: {
            enabled: config.apiTypes.includes(Dab.ApiType.GraphQL),
            basePath: DAB_GRAPHQL_BASE_PATH,
            entities: enabledEntities.map((entity) => ({
                id: entity.id,
                entityName: entity.advancedSettings.entityName,
                schemaName: entity.schemaName,
                tableName: entity.tableName,
                singularName: getGraphQLSingularName(entity),
                pluralName: getGraphQLPluralName(entity),
                operations: createGraphQLOperations(entity),
            })),
        },
        mcp: {
            enabled: config.apiTypes.includes(Dab.ApiType.Mcp),
            basePath: DAB_MCP_BASE_PATH,
            tools: [
                { name: "describe_entities", enabled: enabledEntities.length > 0 },
                {
                    name: "read_records",
                    enabled: enabledEntities.some((entity) =>
                        hasAction(entity, Dab.EntityAction.Read),
                    ),
                },
                {
                    name: "create_record",
                    enabled: enabledEntities.some((entity) =>
                        hasAction(entity, Dab.EntityAction.Create),
                    ),
                },
                {
                    name: "update_record",
                    enabled: enabledEntities.some((entity) =>
                        hasAction(entity, Dab.EntityAction.Update),
                    ),
                },
                {
                    name: "delete_record",
                    enabled: enabledEntities.some((entity) =>
                        hasAction(entity, Dab.EntityAction.Delete),
                    ),
                },
                { name: "execute_entity", enabled: false },
            ],
            entities: enabledEntities.map((entity) => ({
                id: entity.id,
                entityName: entity.advancedSettings.entityName,
                schemaName: entity.schemaName,
                tableName: entity.tableName,
                tools: createMcpToolsForEntity(entity).filter((tool) => tool.enabled),
            })),
            enabledEntityCount: enabledEntities.length,
            enabledActions,
        },
    };
}

function matchesFilter(value: string, filterText: string): boolean {
    return value.toLowerCase().includes(filterText);
}

export function filterDabApiDiagramModel(
    model: DabApiDiagramModel,
    filterText: string,
): DabApiDiagramModel {
    const trimmedFilter = filterText.trim().toLowerCase();
    if (!trimmedFilter) {
        return model;
    }

    return {
        ...model,
        rest: {
            ...model.rest,
            entities: model.rest.entities
                .map((entity) => ({
                    ...entity,
                    endpoints: entity.endpoints.filter((endpoint) =>
                        matchesFilter(
                            `${entity.entityName} ${entity.schemaName} ${entity.tableName} ${endpoint.method} ${endpoint.path}`,
                            trimmedFilter,
                        ),
                    ),
                }))
                .filter((entity) => entity.endpoints.length > 0),
        },
        graphql: {
            ...model.graphql,
            entities: model.graphql.entities
                .map((entity) => ({
                    ...entity,
                    operations: entity.operations.filter((operation) =>
                        matchesFilter(
                            `${entity.entityName} ${entity.schemaName} ${entity.tableName} ${operation.kind} ${operation.name}`,
                            trimmedFilter,
                        ),
                    ),
                }))
                .filter((entity) => entity.operations.length > 0),
        },
        mcp: {
            ...model.mcp,
            tools: model.mcp.tools.filter((tool) => matchesFilter(tool.name, trimmedFilter)),
            entities: model.mcp.entities
                .map((entity) => ({
                    ...entity,
                    tools: entity.tools.filter((tool) =>
                        matchesFilter(
                            `${entity.entityName} ${entity.schemaName} ${entity.tableName} ${tool.name}`,
                            trimmedFilter,
                        ),
                    ),
                }))
                .filter((entity) => entity.tools.length > 0),
        },
    };
}
