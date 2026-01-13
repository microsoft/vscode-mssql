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
        Both = "both",
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
         * Selected API type
         */
        apiType: ApiType;
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
        updateApiType: { apiType: ApiType };
        toggleEntity: { entityId: string; isEnabled: boolean };
        toggleEntityAction: { entityId: string; action: EntityAction; isEnabled: boolean };
        updateEntityAdvancedSettings: { entityId: string; settings: EntityAdvancedSettings };
        setSchemaFilter: { schemaName: string };
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
            apiType: ApiType.Rest,
            entities: tables.map((table) => createDefaultEntityConfig(table)),
        };
    }
}
