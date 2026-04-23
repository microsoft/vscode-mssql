/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc/browser";
import { SchemaDesigner } from "./schemaDesigner";
import { ApiStatus, Status } from "./webview";

/**
 * Data API builder (DAB) interfaces for webview-extension communication
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
     * Represents exposure state for a single backing database column.
     */
    export interface DabColumnConfig {
        /**
         * Unique identifier for the column (matches schema column id)
         */
        id: string;
        /**
         * Backing database column name
         */
        name: string;
        /**
         * Column data type, used for display only
         */
        dataType: string;
        /**
         * Whether the column can be safely exposed through DAB.
         */
        isSupported: boolean;
        /**
         * Whether the column is currently exposed in the generated DAB config.
         */
        isExposed: boolean;
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
         * Whether this table is supported by DAB.
         * Tables without primary keys or with unsupported data types are not supported.
         */
        isSupported: boolean;
        /**
         * Structured reasons why the table is not supported.
         * Only set when isSupported is false. Converted to localized
         * strings in the UI layer.
         */
        unsupportedReasons?: DabUnsupportedReason[];
        /**
         * Enabled CRUD actions for this entity
         */
        enabledActions: EntityAction[];
        /**
         * Column exposure state for backing database columns.
         */
        columns: DabColumnConfig[];
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

    export type DabColumnRef = { id: string } | { name: string };

    export type DabEntitySettingsPatch = Partial<
        Omit<EntityAdvancedSettings, "customRestPath" | "customGraphQLType">
    > & {
        customRestPath?: string | null;
        customGraphQLType?: string | null;
    };

    export type DabToolChange =
        | { type: "set_api_types"; apiTypes: ApiType[] }
        | { type: "set_entity_enabled"; entity: DabEntityRef; isEnabled: boolean }
        | { type: "set_entity_actions"; entity: DabEntityRef; enabledActions: EntityAction[] }
        | {
              type: "set_column_exposed";
              entity: DabEntityRef;
              column: DabColumnRef;
              isExposed: boolean;
          }
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
                  | "entity_not_supported"
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

    export interface GetCachedConfigResponse {
        config?: DabConfig;
    }

    export namespace GetCachedConfigRequest {
        export const type = new RequestType<void, GetCachedConfigResponse, void>(
            "dab/getCachedConfig",
        );
    }

    export interface CacheConfigParams {
        config: DabConfig;
    }

    export namespace CacheConfigNotification {
        export const type = new NotificationType<CacheConfigParams>("dab/cacheConfig");
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
     * Notification to open deployment logs in a new tab.
     */
    export interface OpenLogsInNewTabParams {
        logsContent: string;
    }

    export namespace OpenLogsInNewTabNotification {
        export const type = new NotificationType<OpenLogsInNewTabParams>("dab/openLogsInNewTab");
    }

    /**
     * Notification to copy text to clipboard with a context-appropriate toast message
     */
    export enum CopyTextType {
        Config = "config",
        Url = "url",
        Logs = "logs",
    }

    export interface CopyTextParams {
        text: string;
        copyTextType: CopyTextType;
    }

    export namespace CopyTextNotification {
        export const type = new NotificationType<CopyTextParams>("dab/copyText");
    }

    /**
     * Notification to open a URL in the VS Code built-in browser
     */
    export interface OpenUrlParams {
        url: string;
        apiType?: ApiType;
    }

    export namespace OpenUrlNotification {
        export const type = new NotificationType<OpenUrlParams>("dab/openUrl");
    }

    // ============================================
    // Reducer types for webview state management
    // ============================================

    export interface DabReducers {
        updateApiTypes: { apiTypes: ApiType[] };
        toggleEntity: { entityId: string; isEnabled: boolean };
        toggleEntityAction: { entityId: string; action: EntityAction; isEnabled: boolean };
        toggleEntityColumnExposure: { entityId: string; columnId: string; isExposed: boolean };
        updateEntityAdvancedSettings: { entityId: string; settings: EntityAdvancedSettings };
        setSchemaFilter: { schemaName: string };
    }

    // ============================================
    // Local Container Deployment
    // ============================================

    /**
     * DAB container image from Microsoft Container Registry.
     * Uses :latest tag intentionally so users always get the newest Data API builder
     * features and bug fixes without manual version management.
     */
    export const DAB_CONTAINER_IMAGE = "mcr.microsoft.com/azure-databases/data-api-builder:latest";

    /**
     * Platform to use when pulling the DAB container image.
     * DAB only publishes linux/amd64 images, so this must be specified
     * explicitly to avoid pull failures on Mac ARM (which defaults to linux/arm64).
     */
    export const DAB_CONTAINER_PLATFORM = "linux/amd64";

    /**
     * Default port for DAB container
     */
    export const DAB_DEFAULT_PORT = 5000;

    /**
     * Default container name prefix for DAB
     */
    export const DAB_DEFAULT_CONTAINER_NAME = "dab-container";

    /**
     * Enumeration representing the order of steps in the DAB deployment process
     */
    export enum DabDeploymentStepOrder {
        /** Check if Docker is installed */
        dockerInstallation = 0,
        /** Start Docker Desktop if not running */
        startDockerDesktop = 1,
        /** Check Docker engine is ready */
        checkDockerEngine = 2,
        /** Pull DAB container image */
        pullImage = 3,
        /** Start DAB Docker container */
        startContainer = 4,
        /** Check if DAB container is ready */
        checkContainer = 5,
    }

    /**
     * Enumeration representing the current view/step in the deployment dialog
     */
    export enum DabDeploymentDialogStep {
        /** Initial confirmation dialog */
        Confirmation = 0,
        /** Docker prerequisites check */
        Prerequisites = 1,
        /** Parameter input form (container name, port) */
        ParameterInput = 2,
        /** Deployment progress steps */
        Deployment = 3,
        /** Completion or error state */
        Complete = 4,
    }

    /**
     * Parameters for DAB container deployment
     */
    export interface DabDeploymentParams {
        /**
         * Name for the Docker container
         */
        containerName: string;
        /**
         * Port to expose the DAB API on
         */
        port: number;
    }

    /**
     * Result of a DAB deployment step
     */
    export interface DabDeploymentStepResult {
        /**
         * Whether the step completed successfully
         */
        success: boolean;
        /**
         * Error message if the step failed
         */
        error?: string;
        /**
         * Full error text for debugging
         */
        fullErrorText?: string;
    }

    /**
     * State tracking for the DAB deployment process
     */
    export interface DabDeploymentState {
        /**
         * Whether the deployment dialog is open
         */
        isDialogOpen: boolean;
        /**
         * Current dialog step
         */
        dialogStep: DabDeploymentDialogStep;
        /**
         * Current deployment step (when in Deployment dialog step)
         */
        currentDeploymentStep: DabDeploymentStepOrder;
        /**
         * Deployment parameters from user input
         */
        params: DabDeploymentParams;
        /**
         * Status of each deployment step
         */
        stepStatuses: DabDeploymentStepStatus[];
        /**
         * Whether deployment is in progress
         */
        isDeploying: boolean;
        /**
         * URL where the API is accessible after successful deployment
         */
        apiUrl?: string;
        /**
         * Error message if deployment failed
         */
        error?: string;
    }

    /**
     * Status of an individual deployment step.
     * Extends Status to use standard ApiStatus enum and message field.
     */
    export interface DabDeploymentStepStatus extends Status {
        /**
         * The step this status is for
         */
        step: DabDeploymentStepOrder;
        /**
         * Filtered container logs for display for this step
         */
        containerLogs?: string;
        /**
         * Full error text for debugging
         */
        fullErrorText?: string;
        /**
         * Link to documentation for fixing the error
         */
        errorLink?: string;
        /**
         * Text for the error link
         */
        errorLinkText?: string;
    }

    /**
     * Creates a default deployment state
     */
    export function createDefaultDeploymentState(): DabDeploymentState {
        return {
            isDialogOpen: false,
            dialogStep: DabDeploymentDialogStep.Confirmation,
            currentDeploymentStep: DabDeploymentStepOrder.dockerInstallation,
            params: {
                containerName: DAB_DEFAULT_CONTAINER_NAME,
                port: DAB_DEFAULT_PORT,
            },
            stepStatuses: [
                { step: DabDeploymentStepOrder.dockerInstallation, status: ApiStatus.NotStarted },
                { step: DabDeploymentStepOrder.startDockerDesktop, status: ApiStatus.NotStarted },
                { step: DabDeploymentStepOrder.checkDockerEngine, status: ApiStatus.NotStarted },
                { step: DabDeploymentStepOrder.pullImage, status: ApiStatus.NotStarted },
                { step: DabDeploymentStepOrder.startContainer, status: ApiStatus.NotStarted },
                { step: DabDeploymentStepOrder.checkContainer, status: ApiStatus.NotStarted },
            ],
            isDeploying: false,
        };
    }

    // ============================================
    // Deployment Requests (Webview -> Extension)
    // ============================================

    /**
     * Request to run a specific deployment step
     */
    export interface RunDeploymentStepParams {
        /**
         * The step to run
         */
        step: DabDeploymentStepOrder;
        /**
         * Deployment parameters (needed for some steps)
         */
        params?: DabDeploymentParams;
        /**
         * DAB config (needed for starting the container)
         */
        config?: DabConfig;
    }

    export interface RunDeploymentStepResponse {
        /**
         * Whether the step completed successfully
         */
        success: boolean;
        /**
         * Error message if the step failed
         */
        error?: string;
        /**
         * Full error text for debugging
         */
        fullErrorText?: string;
        /**
         * Filtered container logs captured when the readiness check failed.
         */
        containerLogs?: string;
        /**
         * Link to documentation for fixing the error
         */
        errorLink?: string;
        /**
         * Text for the error link
         */
        errorLinkText?: string;
        /**
         * API URL (returned after successful container start)
         */
        apiUrl?: string;
    }

    export namespace RunDeploymentStepRequest {
        export const type = new RequestType<
            RunDeploymentStepParams,
            RunDeploymentStepResponse,
            void
        >("dab/runDeploymentStep");
    }

    /**
     * Request to validate deployment parameters
     */
    export interface ValidateDeploymentParamsParams {
        /**
         * Container name to validate
         */
        containerName: string;
        /**
         * Port to validate
         */
        port: number;
    }

    export interface ValidateDeploymentParamsResponse {
        /**
         * Whether the container name is valid and unique
         */
        isContainerNameValid: boolean;
        /**
         * Validated/suggested container name (may be auto-generated if input was empty)
         */
        validatedContainerName: string;
        /**
         * Error message for container name if invalid
         */
        containerNameError?: string;
        /**
         * Whether the port is valid and available
         */
        isPortValid: boolean;
        /**
         * Suggested available port (may differ from input if port was in use)
         */
        suggestedPort: number;
        /**
         * Error message for port if invalid
         */
        portError?: string;
    }

    export namespace ValidateDeploymentParamsRequest {
        export const type = new RequestType<
            ValidateDeploymentParamsParams,
            ValidateDeploymentParamsResponse,
            void
        >("dab/validateDeploymentParams");
    }

    /**
     * Request to stop and clean up a DAB container
     */
    export interface StopDeploymentParams {
        /**
         * Name of the container to stop
         */
        containerName: string;
    }

    export interface StopDeploymentResponse {
        /**
         * Whether the container was stopped successfully
         */
        success: boolean;
        /**
         * Error message if stopping failed
         */
        error?: string;
    }

    export namespace StopDeploymentRequest {
        export const type = new RequestType<StopDeploymentParams, StopDeploymentResponse, void>(
            "dab/stopDeployment",
        );
    }

    /**
     * Request to add an MCP server definition to the workspace .vscode/mcp.json
     */
    export interface AddMcpServerParams {
        /**
         * Name for the MCP server entry in mcp.json
         */
        serverName: string;
        /**
         * URL of the MCP server endpoint
         */
        serverUrl: string;
    }

    export interface AddMcpServerResponse {
        /**
         * Whether the operation was successful
         */
        success: boolean;
        /**
         * Error message if operation failed
         */
        error?: string;
    }

    export namespace AddMcpServerRequest {
        export const type = new RequestType<AddMcpServerParams, AddMcpServerResponse, void>(
            "dab/addMcpServer",
        );
    }

    // ============================================
    // Service interface
    // ============================================

    /**
     * Connection information needed for DAB config generation
     */
    export interface DabConnectionInfo {
        connectionString: string;
        /**
         * Name of the SQL Server Docker container, if the SQL Server is running in a container.
         * Used to transform the connection string for DAB container access.
         */
        sqlServerContainerName?: string;
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

        /**
         * Runs a specific DAB deployment step
         * @param step The deployment step to run
         * @param params Optional deployment parameters (container name, port)
         * @param config Optional DAB config (needed for startContainer step)
         * @param connectionInfo Optional connection info for generating config
         */
        runDeploymentStep(
            step: DabDeploymentStepOrder,
            params?: DabDeploymentParams,
            config?: DabConfig,
            connectionInfo?: DabConnectionInfo,
        ): Promise<RunDeploymentStepResponse>;

        /**
         * Validates deployment parameters (container name and port)
         * @param containerName The container name to validate
         * @param port The port to validate
         */
        validateDeploymentParams(
            containerName: string,
            port: number,
        ): Promise<ValidateDeploymentParamsResponse>;

        /**
         * Stops and removes a DAB container
         * @param containerName Name of the container to stop
         */
        stopDeployment(containerName: string): Promise<StopDeploymentResponse>;
    }

    // ============================================
    // Helper functions
    // ============================================

    /**
     * Structured reason for why a table is not supported by DAB.
     * Localization is handled in the UI layer.
     */
    export type DabUnsupportedReason =
        | { type: "noPrimaryKey" }
        | { type: "unsupportedDataTypes"; columns: string };

    /**
     * SQL Server data types that are not supported by Data API builder.
     * Documented at https://learn.microsoft.com/en-us/azure/data-api-builder/feature-availability#unsupported-data-types
     */
    export const DAB_UNSUPPORTED_DATA_TYPES = [
        "sys.geography",
        "sys.geometry",
        "sys.hierarchyid",
        "json",
        "rowversion",
        "sql_variant",
        "vector",
        "xml",
    ];

    /**
     * Validates whether a schema table is supported by DAB.
     * Runs all checks and collects all reasons for unsupported tables.
     * @returns An object with isSupported and an optional reason string.
     */
    export function validateTableForDab(table: SchemaDesigner.Table): {
        isSupported: boolean;
        reasons?: DabUnsupportedReason[];
    } {
        const columns = table.columns ?? [];
        const reasons: DabUnsupportedReason[] = [];

        const hasPrimaryKey = columns.some((c) => c.isPrimaryKey);
        if (!hasPrimaryKey) {
            reasons.push({ type: "noPrimaryKey" });
        }

        const unsupportedColumns = columns.filter(
            (c) => c.dataType && DAB_UNSUPPORTED_DATA_TYPES.includes(c.dataType.toLowerCase()),
        );
        if (unsupportedColumns.length > 0) {
            const details = unsupportedColumns.map((c) => `${c.name} (${c.dataType})`).join(", ");
            reasons.push({ type: "unsupportedDataTypes", columns: details });
        }

        return reasons.length > 0 ? { isSupported: false, reasons } : { isSupported: true };
    }

    /**
     * Determines whether an individual column is supported by DAB.
     */
    export function isColumnSupportedForDab(column: SchemaDesigner.Column): boolean {
        return !(
            column.dataType && DAB_UNSUPPORTED_DATA_TYPES.includes(column.dataType.toLowerCase())
        );
    }

    /**
     * Creates default column exposure configuration from a schema column.
     */
    export function createDefaultColumnConfig(column: SchemaDesigner.Column): DabColumnConfig {
        return {
            id: column.id,
            name: column.name,
            dataType: column.dataType,
            isSupported: isColumnSupportedForDab(column),
            isExposed: true,
        };
    }

    /**
     * Creates default entity configuration from a schema table
     */
    export function createDefaultEntityConfig(table: SchemaDesigner.Table): DabEntityConfig {
        const { isSupported, reasons } = validateTableForDab(table);
        return {
            id: table.id,
            tableName: table.name,
            schemaName: table.schema,
            isEnabled: isSupported,
            isSupported,
            unsupportedReasons: reasons,
            enabledActions: [
                EntityAction.Create,
                EntityAction.Read,
                EntityAction.Update,
                EntityAction.Delete,
            ],
            columns: table.columns.map((column) => createDefaultColumnConfig(column)),
            advancedSettings: {
                entityName: table.name,
                authorizationRole: AuthorizationRole.Anonymous,
            },
        };
    }

    function cloneUnsupportedReasons(
        reasons: DabUnsupportedReason[] | undefined,
    ): DabUnsupportedReason[] | undefined {
        return reasons?.map((reason) => ({ ...reason }));
    }

    function cloneColumns(columns: DabColumnConfig[]): DabColumnConfig[] {
        return columns.map((column) => ({ ...column }));
    }

    function cloneConfig(config: DabConfig): DabConfig {
        return {
            apiTypes: [...config.apiTypes],
            entities: config.entities.map((entity) => ({
                ...entity,
                enabledActions: [...entity.enabledActions],
                columns: cloneColumns(entity.columns),
                unsupportedReasons: cloneUnsupportedReasons(entity.unsupportedReasons),
                advancedSettings: { ...entity.advancedSettings },
            })),
        };
    }

    function syncColumnsWithTable(
        existingColumns: DabColumnConfig[],
        tableColumns: SchemaDesigner.Column[],
    ): { columns: DabColumnConfig[]; changed: boolean } {
        let changed = false;
        const existingById = new Map(existingColumns.map((column) => [column.id, column]));
        const syncedColumns: DabColumnConfig[] = [];

        for (const tableColumn of tableColumns) {
            const existingColumn = existingById.get(tableColumn.id);
            if (!existingColumn) {
                syncedColumns.push(createDefaultColumnConfig(tableColumn));
                changed = true;
                continue;
            }

            const syncedColumn: DabColumnConfig = {
                ...existingColumn,
                name: tableColumn.name,
                dataType: tableColumn.dataType,
                isSupported: isColumnSupportedForDab(tableColumn),
            };

            if (
                existingColumn.name !== syncedColumn.name ||
                existingColumn.dataType !== syncedColumn.dataType ||
                existingColumn.isSupported !== syncedColumn.isSupported
            ) {
                changed = true;
            }

            syncedColumns.push(syncedColumn);
            existingById.delete(tableColumn.id);
        }

        if (existingById.size > 0) {
            changed = true;
        }

        return { columns: syncedColumns, changed };
    }

    export function syncEntityConfigWithTable(
        entity: DabEntityConfig,
        table: SchemaDesigner.Table,
    ): DabEntityConfig {
        const { isSupported, reasons } = validateTableForDab(table);
        const syncedColumns = syncColumnsWithTable(entity.columns, table.columns ?? []);
        return {
            ...entity,
            tableName: table.name,
            schemaName: table.schema,
            isSupported,
            unsupportedReasons: reasons,
            columns: syncedColumns.columns,
            // Unsupported entities must remain disabled until the schema is fixed.
            isEnabled: !isSupported ? false : entity.isEnabled,
        };
    }

    export function syncConfigWithSchema(
        currentConfig: DabConfig | null,
        schemaTables: SchemaDesigner.Table[],
    ): { config: DabConfig; changed: boolean } {
        let changed = false;
        const normalizedConfig = currentConfig
            ? cloneConfig(currentConfig)
            : createDefaultConfig(schemaTables);
        if (!currentConfig) {
            changed = true;
        }

        const tablesById = new Map(schemaTables.map((table) => [table.id, table]));
        const syncedEntities: DabEntityConfig[] = [];

        for (const entity of normalizedConfig.entities) {
            const table = tablesById.get(entity.id);
            if (!table) {
                changed = true;
                continue;
            }

            const syncedEntity = syncEntityConfigWithTable(entity, table);
            if (
                entity.tableName !== syncedEntity.tableName ||
                entity.schemaName !== syncedEntity.schemaName ||
                entity.isSupported !== syncedEntity.isSupported ||
                JSON.stringify(entity.columns) !== JSON.stringify(syncedEntity.columns) ||
                JSON.stringify(entity.unsupportedReasons) !==
                    JSON.stringify(syncedEntity.unsupportedReasons) ||
                entity.isEnabled !== syncedEntity.isEnabled
            ) {
                changed = true;
            }

            syncedEntities.push(syncedEntity);
            tablesById.delete(entity.id);
        }

        for (const table of schemaTables) {
            if (!tablesById.has(table.id)) {
                continue;
            }

            syncedEntities.push(createDefaultEntityConfig(table));
            changed = true;
        }

        return {
            config: {
                ...normalizedConfig,
                entities: syncedEntities,
            },
            changed,
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
