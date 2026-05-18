/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dab } from "../sharedInterfaces/dab";
import { validateDabAdvancedJson } from "./dabAdvancedJsonValidation";
import { normalizeIdentifier } from "./dabSnapshot";

export type DabApplyFailureReason = Extract<
    Dab.ApplyDabToolChangesResponse,
    { success: false }
>["reason"];

type DabMutationResult =
    | { success: true }
    | { success: false; reason: DabApplyFailureReason; message: string };

function createDabValidationError(message: string): DabMutationResult {
    return {
        success: false,
        reason: "validation_error",
        message,
    };
}

function hasUnsafeConfigText(value: string): boolean {
    return (
        /<\s*\/?\s*script\b/i.test(value) ||
        /<[^>]+>/.test(value) ||
        /;\s*(drop|delete|insert|update|alter|create|truncate)\b/i.test(value) ||
        /--/.test(value) ||
        /[\u0000-\u001f\u007f]/.test(value)
    );
}

function validateSafeString(
    propertyName: string,
    value: string,
    maxLength: number,
): DabMutationResult {
    if (value.length > maxLength) {
        return createDabValidationError(`${propertyName} must be ${maxLength} characters or less.`);
    }
    if (hasUnsafeConfigText(value)) {
        return createDabValidationError(`${propertyName} contains unsupported or unsafe text.`);
    }
    return { success: true };
}

function validateEntityName(value: string): DabMutationResult {
    const safe = validateSafeString("entityName", value, 128);
    if (safe.success === false) {
        return safe;
    }
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) {
        return createDabValidationError(
            "entityName must start with a letter and contain only letters, numbers, and underscores.",
        );
    }
    return { success: true };
}

function normalizeRestPath(value: string): string {
    const trimmed = value.trim();
    return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function validateRestPath(value: string): DabMutationResult {
    const safe = validateSafeString("customRestPath", value, 128);
    if (safe.success === false) {
        return safe;
    }
    if (!/^\/[A-Za-z0-9][A-Za-z0-9/_-]*$/.test(value)) {
        return createDabValidationError(
            "customRestPath must be a URL path using letters, numbers, slashes, underscores, or hyphens.",
        );
    }
    if (value.includes("//")) {
        return createDabValidationError("customRestPath cannot contain empty path segments.");
    }
    return { success: true };
}

function validateGraphQLType(value: string): DabMutationResult {
    const safe = validateSafeString("customGraphQLType", value, 128);
    if (safe.success === false) {
        return safe;
    }
    if (!/^[_A-Za-z][_0-9A-Za-z]*$/.test(value) || value.startsWith("__")) {
        return createDabValidationError(
            "customGraphQLType must be a valid GraphQL type name and cannot start with '__'.",
        );
    }
    return { success: true };
}

function getDuplicateEntityName(config: Dab.DabConfig): string | undefined {
    const seen = new Set<string>();
    for (const entity of config.entities) {
        const normalizedEntityName = normalizeIdentifier(entity.advancedSettings.entityName);
        if (!normalizedEntityName) {
            continue;
        }
        if (seen.has(normalizedEntityName)) {
            return entity.advancedSettings.entityName;
        }
        seen.add(normalizedEntityName);
    }
    return undefined;
}

function getDuplicateCustomRestPath(config: Dab.DabConfig): string | undefined {
    const seen = new Set<string>();
    for (const entity of config.entities) {
        if (!entity.isEnabled || !entity.advancedSettings.customRestPath) {
            continue;
        }
        const normalizedPath = normalizeRestPath(entity.advancedSettings.customRestPath)
            .trim()
            .toLowerCase();
        if (seen.has(normalizedPath)) {
            return entity.advancedSettings.customRestPath;
        }
        seen.add(normalizedPath);
    }
    return undefined;
}

function getDuplicateCustomGraphQLType(config: Dab.DabConfig): string | undefined {
    const seen = new Set<string>();
    for (const entity of config.entities) {
        if (!entity.isEnabled || !entity.advancedSettings.customGraphQLType) {
            continue;
        }
        const normalizedType = normalizeIdentifier(entity.advancedSettings.customGraphQLType);
        if (seen.has(normalizedType)) {
            return entity.advancedSettings.customGraphQLType;
        }
        seen.add(normalizedType);
    }
    return undefined;
}

function resolveEntityRef(
    config: Dab.DabConfig,
    entityRef: Dab.DabEntityRef,
):
    | { success: true; entity: Dab.DabEntityConfig; index: number }
    | { success: false; reason: DabApplyFailureReason; message: string } {
    const hasId = typeof (entityRef as { id?: unknown }).id === "string";
    const hasSchemaTable =
        typeof (entityRef as { schemaName?: unknown }).schemaName === "string" &&
        typeof (entityRef as { tableName?: unknown }).tableName === "string";

    if (hasId === hasSchemaTable) {
        return {
            success: false,
            reason: "invalid_request",
            message: "Invalid entity reference. Use either id OR schemaName+tableName.",
        };
    }

    if (hasId) {
        const id = (entityRef as { id: string }).id;
        const index = config.entities.findIndex((entity) => entity.id === id);
        if (index < 0) {
            return {
                success: false,
                reason: "not_found",
                message: `Entity not found: ${id}`,
            };
        }
        return { success: true, entity: config.entities[index], index };
    }

    const schemaName = normalizeIdentifier((entityRef as { schemaName: string }).schemaName);
    const tableName = normalizeIdentifier((entityRef as { tableName: string }).tableName);
    const matches = config.entities
        .map((entity, index) => ({ entity, index }))
        .filter(
            ({ entity }) =>
                normalizeIdentifier(entity.schemaName) === schemaName &&
                normalizeIdentifier(entity.tableName) === tableName,
        );

    if (matches.length === 0) {
        return {
            success: false,
            reason: "not_found",
            message: `Entity not found: ${(entityRef as { schemaName: string }).schemaName}.${(entityRef as { tableName: string }).tableName}`,
        };
    }

    if (matches.length > 1) {
        return {
            success: false,
            reason: "validation_error",
            message: `Entity reference resolved to more than one entity: ${(entityRef as { schemaName: string }).schemaName}.${(entityRef as { tableName: string }).tableName}`,
        };
    }

    return {
        success: true,
        entity: matches[0].entity,
        index: matches[0].index,
    };
}

function resolveColumnRef(
    entity: Dab.DabEntityConfig,
    columnRef: Dab.DabColumnRef,
):
    | { success: true; column: Dab.DabColumnConfig; index: number }
    | { success: false; reason: DabApplyFailureReason; message: string } {
    const hasId = typeof (columnRef as { id?: unknown }).id === "string";
    const hasName = typeof (columnRef as { name?: unknown }).name === "string";

    if (hasId === hasName) {
        return {
            success: false,
            reason: "invalid_request",
            message: "Invalid column reference. Use either id OR name.",
        };
    }

    if (hasId) {
        const id = (columnRef as { id: string }).id;
        const index = entity.columns.findIndex((column) => column.id === id);
        if (index < 0) {
            return {
                success: false,
                reason: "not_found",
                message: `Column not found: ${id}`,
            };
        }

        return { success: true, column: entity.columns[index], index };
    }

    const name = normalizeIdentifier((columnRef as { name: string }).name);
    const matches = entity.columns
        .map((column, index) => ({ column, index }))
        .filter(({ column }) => normalizeIdentifier(column.name) === name);

    if (matches.length === 0) {
        return {
            success: false,
            reason: "not_found",
            message: `Column not found: ${(columnRef as { name: string }).name}`,
        };
    }

    if (matches.length > 1) {
        return {
            success: false,
            reason: "validation_error",
            message: `Column reference resolved to more than one column: ${(columnRef as { name: string }).name}`,
        };
    }

    return {
        success: true,
        column: matches[0].column,
        index: matches[0].index,
    };
}

function formatUnsupportedEntityReasons(reasons: Dab.DabUnsupportedReason[] | undefined): string {
    if (!reasons || reasons.length === 0) {
        return "Unsupported by Data API builder.";
    }

    return reasons
        .map((reason) => {
            switch (reason.type) {
                case "noPrimaryKey":
                    return "Table must have a primary key to be used with Data API builder";
                case "unsupportedDataTypes":
                    return `Table contains column types not supported by Data API builder: ${reason.columns}`;
            }
        })
        .join("; ");
}

function createEntityNotSupportedError(entity: Dab.DabEntityConfig): DabMutationResult {
    return {
        success: false,
        reason: "entity_not_supported",
        message:
            `Entity '${entity.schemaName}.${entity.tableName}' is not supported by Data API builder. ` +
            formatUnsupportedEntityReasons(entity.unsupportedReasons),
    };
}

function validateSupportedEntityForMutation(entity: Dab.DabEntityConfig): DabMutationResult {
    return entity.isSupported ? { success: true } : createEntityNotSupportedError(entity);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cloneAdvancedJson(value: Record<string, unknown> | undefined): Record<string, unknown> {
    return value ? { ...value } : {};
}

function mergeAdvancedJsonPatch(
    current: Record<string, unknown> | undefined,
    patch: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const next = cloneAdvancedJson(current);
    for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) {
            return undefined;
        }
        if (value === null) {
            delete next[key];
            continue;
        }
        next[key] = value;
    }
    return Object.keys(next).length > 0 ? next : undefined;
}

function validateAdvancedJsonPatch(
    scope: "top-level" | "entity",
    patch: unknown,
): DabMutationResult {
    if (!isRecord(patch)) {
        return {
            success: false,
            reason: "invalid_request",
            message:
                scope === "top-level"
                    ? "patch_config_advanced_json.set must be an object."
                    : "patch_entity_advanced_json.set must be an object.",
        };
    }

    if (Object.keys(patch).length === 0) {
        return {
            success: false,
            reason: "invalid_request",
            message:
                scope === "top-level"
                    ? "patch_config_advanced_json.set must include at least one property."
                    : "patch_entity_advanced_json.set must include at least one property.",
        };
    }

    const error = validateDabAdvancedJson(scope, patch);
    if (error) {
        return createDabValidationError(error);
    }

    return { success: true };
}

function getAllowedActionsForEntity(entity: Dab.DabEntityConfig): Set<Dab.EntityAction> {
    if (entity.sourceType === "stored-procedure") {
        return new Set([Dab.EntityAction.Execute]);
    }

    return new Set([
        Dab.EntityAction.Create,
        Dab.EntityAction.Read,
        Dab.EntityAction.Update,
        Dab.EntityAction.Delete,
    ]);
}

export function validateDabConfig(config: Dab.DabConfig): DabMutationResult {
    const topLevelAdvancedJsonError = validateDabAdvancedJson("top-level", config.advancedJson);
    if (topLevelAdvancedJsonError) {
        return createDabValidationError(topLevelAdvancedJsonError);
    }

    const duplicateEntityName = getDuplicateEntityName(config);
    if (duplicateEntityName) {
        return createDabValidationError(
            `entityName must be unique across entities. Duplicate: ${duplicateEntityName}`,
        );
    }

    const duplicateRestPath = getDuplicateCustomRestPath(config);
    if (duplicateRestPath) {
        return createDabValidationError(
            `customRestPath must be unique across enabled entities. Duplicate: ${duplicateRestPath}`,
        );
    }

    const duplicateGraphQLType = getDuplicateCustomGraphQLType(config);
    if (duplicateGraphQLType) {
        return createDabValidationError(
            `customGraphQLType must be unique across enabled entities. Duplicate: ${duplicateGraphQLType}`,
        );
    }

    for (const entity of config.entities) {
        const entityAdvancedJsonError = validateDabAdvancedJson("entity", entity.advancedJson);
        if (entityAdvancedJsonError) {
            return createDabValidationError(
                `${entity.advancedSettings.entityName}: ${entityAdvancedJsonError}`,
            );
        }

        if (entity.isEnabled && !entity.isSupported) {
            return createEntityNotSupportedError(entity);
        }

        const entityNameValidation = validateEntityName(entity.advancedSettings.entityName);
        if (entityNameValidation.success === false) {
            return entityNameValidation;
        }

        if (entity.advancedSettings.customRestPath) {
            const restPathValidation = validateRestPath(entity.advancedSettings.customRestPath);
            if (restPathValidation.success === false) {
                return restPathValidation;
            }
        }

        if (entity.advancedSettings.customGraphQLType) {
            const graphQLValidation = validateGraphQLType(
                entity.advancedSettings.customGraphQLType,
            );
            if (graphQLValidation.success === false) {
                return graphQLValidation;
            }
        }

        for (const column of entity.columns) {
            if (entity.isEnabled && column.isPrimaryKey && !column.isExposed) {
                return createDabValidationError("Primary key columns must remain exposed.");
            }
            if (entity.isEnabled && !column.isSupported && column.isExposed) {
                return createDabValidationError(
                    `Unsupported column '${column.name}' cannot be exposed.`,
                );
            }
        }
    }

    return { success: true };
}

export function applyDabToolChange(
    config: Dab.DabConfig,
    change: Dab.DabToolChange,
): DabMutationResult {
    const allowedApiTypes = new Set<Dab.ApiType>(Object.values(Dab.ApiType));
    switch (change.type) {
        case "set_api_types": {
            if (!Array.isArray(change.apiTypes) || change.apiTypes.length === 0) {
                return createDabValidationError("apiTypes must be a non-empty array.");
            }
            const uniqueApiTypes = new Set(change.apiTypes);
            if (uniqueApiTypes.size !== change.apiTypes.length) {
                return createDabValidationError("apiTypes must be unique.");
            }
            if (change.apiTypes.some((apiType) => !allowedApiTypes.has(apiType))) {
                return createDabValidationError("apiTypes contains unsupported values.");
            }
            config.apiTypes = [...change.apiTypes];
            return { success: true };
        }

        case "set_entity_enabled": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }
            if (change.isEnabled) {
                const supportValidation = validateSupportedEntityForMutation(resolvedEntity.entity);
                if (supportValidation.success === false) {
                    return supportValidation;
                }
            }
            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                isEnabled: change.isEnabled,
            };
            return { success: true };
        }

        case "set_entity_actions": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }
            const supportValidation = validateSupportedEntityForMutation(resolvedEntity.entity);
            if (supportValidation.success === false) {
                return supportValidation;
            }

            if (!Array.isArray(change.enabledActions) || change.enabledActions.length === 0) {
                return createDabValidationError("enabledActions must be a non-empty array.");
            }
            const uniqueActions = new Set(change.enabledActions);
            if (uniqueActions.size !== change.enabledActions.length) {
                return createDabValidationError("enabledActions must be unique.");
            }
            const allowedActions = getAllowedActionsForEntity(resolvedEntity.entity);
            if (change.enabledActions.some((action) => !allowedActions.has(action))) {
                return createDabValidationError("enabledActions contains unsupported values.");
            }

            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                enabledActions: [...change.enabledActions],
            };
            return { success: true };
        }

        case "set_column_exposed": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }

            const supportValidation = validateSupportedEntityForMutation(resolvedEntity.entity);
            if (supportValidation.success === false) {
                return supportValidation;
            }

            const resolvedColumn = resolveColumnRef(resolvedEntity.entity, change.column);
            if (resolvedColumn.success === false) {
                return resolvedColumn;
            }

            if (resolvedColumn.column.isPrimaryKey && !change.isExposed) {
                return createDabValidationError("Primary key columns must remain exposed.");
            }

            if (!resolvedColumn.column.isSupported && change.isExposed) {
                return createDabValidationError(
                    `Unsupported column '${resolvedColumn.column.name}' cannot be exposed.`,
                );
            }

            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                columns: resolvedEntity.entity.columns.map((column, index) =>
                    index === resolvedColumn.index
                        ? { ...column, isExposed: change.isExposed }
                        : column,
                ),
            };
            return { success: true };
        }

        case "patch_entity_settings": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }
            const supportValidation = validateSupportedEntityForMutation(resolvedEntity.entity);
            if (supportValidation.success === false) {
                return supportValidation;
            }

            const patch = change.set ?? {};
            const patchKeys = Object.keys(patch);
            if (patchKeys.length === 0) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message: "patch_entity_settings.set must include at least one property.",
                };
            }

            const updatedSettings: Dab.EntityAdvancedSettings = {
                ...resolvedEntity.entity.advancedSettings,
            };

            for (const key of patchKeys) {
                const value = (patch as Record<string, unknown>)[key];
                switch (key) {
                    case "entityName": {
                        if (typeof value !== "string" || value.trim().length === 0) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "entityName must be a non-empty string.",
                            };
                        }
                        const entityName = value.trim();
                        const validation = validateEntityName(entityName);
                        if (validation.success === false) {
                            return validation;
                        }
                        updatedSettings.entityName = entityName;
                        break;
                    }
                    case "authorizationRole":
                        if (
                            value !== Dab.AuthorizationRole.Anonymous &&
                            value !== Dab.AuthorizationRole.Authenticated
                        ) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message:
                                    "authorizationRole must be 'anonymous' or 'authenticated'.",
                            };
                        }
                        updatedSettings.authorizationRole = value;
                        break;
                    case "customRestPath": {
                        if (value === null || typeof value === "undefined") {
                            delete updatedSettings.customRestPath;
                            break;
                        }
                        if (typeof value !== "string") {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customRestPath must be a string or null.",
                            };
                        }
                        if (value.trim().length === 0) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customRestPath cannot be an empty string.",
                            };
                        }
                        const customRestPath = normalizeRestPath(value);
                        const validation = validateRestPath(customRestPath);
                        if (validation.success === false) {
                            return validation;
                        }
                        updatedSettings.customRestPath = customRestPath;
                        break;
                    }
                    case "customGraphQLType": {
                        if (value === null || typeof value === "undefined") {
                            delete updatedSettings.customGraphQLType;
                            break;
                        }
                        if (typeof value !== "string") {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customGraphQLType must be a string or null.",
                            };
                        }
                        if (value.trim().length === 0) {
                            return {
                                success: false,
                                reason: "invalid_request",
                                message: "customGraphQLType cannot be an empty string.",
                            };
                        }
                        const customGraphQLType = value.trim();
                        const validation = validateGraphQLType(customGraphQLType);
                        if (validation.success === false) {
                            return validation;
                        }
                        updatedSettings.customGraphQLType = customGraphQLType;
                        break;
                    }
                    default:
                        return {
                            success: false,
                            reason: "invalid_request",
                            message: `Unsupported patch property: ${key}.`,
                        };
                }
            }

            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                advancedSettings: updatedSettings,
            };
            return { success: true };
        }

        case "patch_config_advanced_json": {
            const patchValidation = validateAdvancedJsonPatch("top-level", change.set);
            if (patchValidation.success === false) {
                return patchValidation;
            }

            const nextAdvancedJson = mergeAdvancedJsonPatch(config.advancedJson, change.set);
            if (nextAdvancedJson === undefined && Object.values(change.set).includes(undefined)) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message: "patch_config_advanced_json.set cannot contain undefined values.",
                };
            }
            config.advancedJson = nextAdvancedJson;
            return { success: true };
        }

        case "patch_entity_advanced_json": {
            const resolvedEntity = resolveEntityRef(config, change.entity);
            if (resolvedEntity.success === false) {
                return resolvedEntity;
            }

            const patchValidation = validateAdvancedJsonPatch("entity", change.set);
            if (patchValidation.success === false) {
                return patchValidation;
            }

            const nextAdvancedJson = mergeAdvancedJsonPatch(
                resolvedEntity.entity.advancedJson,
                change.set,
            );
            if (nextAdvancedJson === undefined && Object.values(change.set).includes(undefined)) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message: "patch_entity_advanced_json.set cannot contain undefined values.",
                };
            }

            config.entities[resolvedEntity.index] = {
                ...resolvedEntity.entity,
                advancedJson: nextAdvancedJson,
            };
            return { success: true };
        }

        case "set_only_enabled_entities": {
            if (!Array.isArray(change.entities) || change.entities.length === 0) {
                return {
                    success: false,
                    reason: "invalid_request",
                    message: "set_only_enabled_entities.entities must be a non-empty array.",
                };
            }

            const selectedEntityIds = new Set<string>();
            for (const entityRef of change.entities) {
                const resolvedEntity = resolveEntityRef(config, entityRef);
                if (resolvedEntity.success === false) {
                    return resolvedEntity;
                }
                const supportValidation = validateSupportedEntityForMutation(resolvedEntity.entity);
                if (supportValidation.success === false) {
                    return supportValidation;
                }
                selectedEntityIds.add(resolvedEntity.entity.id);
            }

            config.entities = config.entities.map((entity) => ({
                ...entity,
                isEnabled: selectedEntityIds.has(entity.id),
            }));
            return { success: true };
        }

        case "set_all_entities_enabled": {
            config.entities = config.entities.map((entity) => ({
                ...entity,
                isEnabled: change.isEnabled ? entity.isSupported : false,
            }));
            return { success: true };
        }

        default:
            return {
                success: false,
                reason: "invalid_request",
                message: `Unknown change type: ${(change as { type?: string }).type ?? "unknown"}`,
            };
    }
}
