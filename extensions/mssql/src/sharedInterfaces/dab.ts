/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { SchemaDesigner } from "./schemaDesigner";

/**
 * Data API Builder (DAB) interfaces for webview-extension communication
 */
export namespace Dab {
    /**
     * API types that can be enabled for DAB
     */
    export enum ApiType {
        Rest = "rest",
        GraphQL = "graphql",
        Mcp = "mcp",
    }

    /**
     * CRUD actions that can be enabled per entity
     */
    export enum EntityAction {
        Create = "create",
        Read = "read",
        Update = "update",
        Delete = "delete",
    }

    /**
     * Authorization roles for entity access
     */
    export enum AuthorizationRole {
        Anonymous = "anonymous",
        Authenticated = "authenticated",
    }

    /**
     * Advanced configuration options for an entity
     */
    export interface EntityAdvancedSettings {
        /**
         * Custom entity name used in API routes (defaults to table name)
         */
        entityName: string;
        /**
         * Authorization role for the entity
         */
        authorizationRole: AuthorizationRole;
        /**
         * Custom REST path (overrides default /api/entityName)
         */
        customRestPath?: string;
        /**
         * Custom GraphQL type name (overrides default entity name)
         */
        customGraphQLType?: string;
    }

    /**
     * Represents a table entity configured for DAB
     */
    export interface DabEntityConfig {
        /**
         * Unique identifier for the entity (matches table id from schema)
         */
        id: string;
        /**
         * Table name
         */
        tableName: string;
        /**
         * Schema name
         */
        schemaName: string;
        /**
         * Whether this entity is enabled for API generation
         */
        isEnabled: boolean;
        /**
         * Enabled CRUD actions for this entity
         */
        enabledActions: EntityAction[];
        /**
         * Advanced settings for this entity
         */
        advancedSettings: EntityAdvancedSettings;
    }

    /**
     * Global DAB configuration
     */
    export interface DabConfig {
        /**
         * Selected API types
         */
        apiTypes: ApiType[];
        /**
         * Entity configurations for each table
         */
        entities: DabEntityConfig[];
    }

    /**
     * State for the DAB webview
     */
    export interface DabWebviewState {
        /**
         * Current DAB configuration
         */
        config: DabConfig;
        /**
         * Available tables from the schema (read-only reference)
         */
        availableTables: SchemaDesigner.Table[];
        /**
         * Currently selected schema filter (empty string means all schemas)
         */
        selectedSchemaFilter: string;
        /**
         * Available schema names for filtering
         */
        availableSchemas: string[];
    }

    // ============================================
    // Requests (Webview -> Extension)
    // ============================================

    /**
     * Request to initialize DAB state from current schema
     */
    export interface InitializeDabParams {
        /**
         * Tables from the schema designer
         */
        tables: SchemaDesigner.Table[];
        /**
         * Available schema names
         */
        schemaNames: string[];
    }

    export interface InitializeDabResponse {
        /**
         * Initial DAB configuration with default settings
         */
        config: DabConfig;
    }

    export namespace InitializeDabRequest {
        export const type = new RequestType<InitializeDabParams, InitializeDabResponse, void>(
            "dab/initialize",
        );
    }

    /**
     * Request to generate and preview the DAB config file
     */
    export interface GenerateConfigParams {
        config: DabConfig;
    }

    export interface GenerateConfigResponse {
        /**
         * Generated DAB configuration JSON content
         */
        configContent: string;
        /**
         * Whether the config was generated successfully
         */
        success: boolean;
        /**
         * Error message if generation failed
         */
        error?: string;
    }

    export namespace GenerateConfigRequest {
        export const type = new RequestType<GenerateConfigParams, GenerateConfigResponse, void>(
            "dab/generateConfig",
        );
    }

    /**
     * Request to generate config and run the DAB container
     */
    export interface GenerateAndRunParams {
        config: DabConfig;
    }

    export interface GenerateAndRunResponse {
        /**
         * Whether the operation was successful
         */
        success: boolean;
        /**
         * Error message if operation failed
         */
        error?: string;
        /**
         * URL where the API is accessible (if container started successfully)
         */
        apiUrl?: string;
    }

    export namespace GenerateAndRunRequest {
        export const type = new RequestType<GenerateAndRunParams, GenerateAndRunResponse, void>(
            "dab/generateAndRun",
        );
    }

    /**
     * Entity reference for DAB tool operations.
     * Exactly one form is supported: id OR schemaName+tableName.
     */
    export type DabEntityRef = { id: string } | { schemaName: string; tableName: string };

    export type DabEntitySettingsPatch = Partial<
        Omit<EntityAdvancedSettings, "customRestPath" | "customGraphQLType">
    > & {
        customRestPath?: string | null;
        customGraphQLType?: string | null;
    };

    export type DabToolChange =
        | { type: "set_api_types"; apiTypes: ApiType[] }
        | { type: "set_entity_enabled"; entity: DabEntityRef; isEnabled: boolean }
        | { type: "set_entity_actions"; entity: DabEntityRef; actions: EntityAction[] }
        | { type: "patch_entity_settings"; entity: DabEntityRef; set: DabEntitySettingsPatch }
        | { type: "set_only_enabled_entities"; entities: DabEntityRef[] }
        | { type: "set_all_entities_enabled"; isEnabled: boolean };

    export interface DabToolSummary {
        entityCount: number;
        enabledEntityCount: number;
        apiTypes: ApiType[];
    }

    export interface GetDabToolStateResponse {
        returnState: "full" | "summary";
        stateOmittedReason?: "entity_count_over_threshold";
        version: string;
        summary: DabToolSummary;
        config?: DabConfig;
    }

    export namespace GetDabToolStateRequest {
        export const type = new RequestType<void, GetDabToolStateResponse, void>(
            "dab/tool/getState",
        );
    }

    export interface ApplyDabToolChangesParams {
        expectedVersion: string;
        changes: DabToolChange[];
        options?: {
            returnState?: "full" | "summary" | "none";
        };
    }

    export type ApplyDabToolChangesResponse =
        | {
              success: true;
              appliedChanges: number;
              returnState: "full" | "summary" | "none";
              stateOmittedReason?:
                  | "entity_count_over_threshold"
                  | "caller_requested_summary"
                  | "caller_requested_none";
              version: string;
              summary: DabToolSummary;
              config?: DabConfig;
          }
        | {
              success: false;
              reason:
                  | "stale_state"
                  | "not_found"
                  | "invalid_request"
                  | "validation_error"
                  | "internal_error";
              message: string;
              failedChangeIndex?: number;
              appliedChanges?: number;
              version?: string;
              summary?: DabToolSummary;
              returnState?: "full" | "summary" | "none";
              stateOmittedReason?:
                  | "entity_count_over_threshold"
                  | "caller_requested_summary"
                  | "caller_requested_none";
              config?: DabConfig;
          };

    export namespace ApplyDabToolChangesRequest {
        export const type = new RequestType<
            ApplyDabToolChangesParams,
            ApplyDabToolChangesResponse,
            void
        >("dab/tool/applyChanges");
    }

    // ============================================
    // Notifications (Webview -> Extension)
    // ============================================

    /**
     * Notification to open the generated config in the editor
     */
    export interface OpenConfigInEditorParams {
        configContent: string;
    }

    export namespace OpenConfigInEditorNotification {
        export const type = new NotificationType<OpenConfigInEditorParams>(
            "dab/openConfigInEditor",
        );
    }

    /**
     * Notification to copy config to clipboard
     */
    export interface CopyConfigParams {
        configContent: string;
    }

    export namespace CopyConfigNotification {
        export const type = new NotificationType<CopyConfigParams>("dab/copyConfig");
    }

    // ============================================
    // Reducer types for webview state management
    // ============================================

    export interface DabReducers {
        updateApiTypes: { apiTypes: ApiType[] };
        toggleEntity: { entityId: string; isEnabled: boolean };
        toggleEntityAction: { entityId: string; action: EntityAction; isEnabled: boolean };
        updateEntityAdvancedSettings: { entityId: string; settings: EntityAdvancedSettings };
        setSchemaFilter: { schemaName: string };
    }

    // ============================================
    // Service interface
    // ============================================

    /**
     * Connection information needed for DAB config generation
     */
    export interface DabConnectionInfo {
        connectionString: string;
    }

    /**
     * Service interface for DAB operations
     */
    export interface IDabService {
        /**
         * Generates a DAB configuration JSON from the internal config model
         */
        generateConfig(
            config: DabConfig,
            connectionInfo: DabConnectionInfo,
        ): GenerateConfigResponse;
    }

    // ============================================
    // Helper functions
    // ============================================

    /**
     * Creates default entity configuration from a schema table
     */
    export function createDefaultEntityConfig(table: SchemaDesigner.Table): DabEntityConfig {
        return {
            id: table.id,
            tableName: table.name,
            schemaName: table.schema,
            isEnabled: true,
            enabledActions: [
                EntityAction.Create,
                EntityAction.Read,
                EntityAction.Update,
                EntityAction.Delete,
            ],
            advancedSettings: {
                entityName: table.name,
                authorizationRole: AuthorizationRole.Anonymous,
            },
        };
    }

    /**
     * Creates default DAB configuration from schema tables
     */
    export function createDefaultConfig(tables: SchemaDesigner.Table[]): DabConfig {
        return {
            apiTypes: [ApiType.Rest],
            entities: tables.map((table) => createDefaultEntityConfig(table)),
        };
    }
}
