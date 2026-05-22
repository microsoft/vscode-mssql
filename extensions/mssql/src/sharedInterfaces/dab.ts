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
        Execute = "execute",
    }

    export enum RestMethod {
        Get = "get",
        Post = "post",
        Put = "put",
        Patch = "patch",
        Delete = "delete",
    }

    const restMethodSortOrder = [
        RestMethod.Get,
        RestMethod.Post,
        RestMethod.Put,
        RestMethod.Patch,
        RestMethod.Delete,
    ];

    /**
     * Canonicalizes REST methods so semantically equivalent method sets do not
     * produce noisy config diffs or version hash changes.
     */
    export function normalizeRestMethods(methods: RestMethod[]): RestMethod[] {
        const uniqueMethods = new Set(methods);
        return restMethodSortOrder.filter((method) => uniqueMethods.has(method));
    }

    export const maxDabEntityNameLength = 128;
    export const maxDabRoutePathLength = 256;

    const dabEntityNamePattern = /^[A-Za-z][A-Za-z0-9_]*$/;
    const dabGraphQLTypePattern = /^[_A-Za-z][_0-9A-Za-z]*$/;
    const dabRestPathPattern = /^\/?[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;

    export function normalizeDabIdentifier(value: string | undefined): string {
        return (value ?? "").trim().toLowerCase();
    }

    export function validateDabEntityName(value: string): string | undefined {
        if (value.length > maxDabEntityNameLength) {
            return `entityName must be ${maxDabEntityNameLength} characters or fewer.`;
        }
        if (!dabEntityNamePattern.test(value)) {
            return "entityName must start with a letter and contain only letters, numbers, and underscores.";
        }
        return undefined;
    }

    export function validateDabCustomRestPath(value: string): string | undefined {
        if (value.length > maxDabRoutePathLength) {
            return `customRestPath must be ${maxDabRoutePathLength} characters or fewer.`;
        }
        if (!dabRestPathPattern.test(value)) {
            return "customRestPath must be a relative route path using letters, numbers, slash, dot, underscore, tilde, or hyphen.";
        }
        return undefined;
    }

    export function validateDabCustomGraphQLType(value: string): string | undefined {
        if (value.length > maxDabEntityNameLength) {
            return `customGraphQLType must be ${maxDabEntityNameLength} characters or fewer.`;
        }
        if (!dabGraphQLTypePattern.test(value)) {
            return "customGraphQLType must be a valid GraphQL name.";
        }
        return undefined;
    }

    export enum GraphQLOperation {
        Query = "query",
        Mutation = "mutation",
    }

    /**
     * Database object source types supported by DAB.
     */
    export enum EntitySourceType {
        Table = "table",
        View = "view",
        StoredProcedure = "stored-procedure",
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
         * Whether this entity should be exposed through REST when REST is globally enabled.
         * Defaults to true.
         */
        restEnabled?: boolean;
        /**
         * Custom GraphQL type name (overrides default entity name)
         */
        customGraphQLType?: string;
        /**
         * Whether this entity should be exposed through GraphQL when GraphQL is globally enabled.
         * Defaults to true.
         */
        graphQLEnabled?: boolean;
        /**
         * Stored procedure REST methods. Defaults to POST.
         */
        storedProcedureRestMethods?: RestMethod[];
        /**
         * Stored procedure GraphQL operation. Defaults to mutation.
         */
        storedProcedureGraphQLOperation?: GraphQLOperation;
        /**
         * Whether a stored procedure entity should be exposed as a dedicated MCP custom tool.
         * Defaults to true for stored procedures.
         */
        exposeAsMcpCustomTool?: boolean;
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
         * Whether the column is part of the primary key.
         */
        isPrimaryKey: boolean;
        /**
         * Whether the column can be safely exposed through DAB.
         */
        isSupported: boolean;
        /**
         * Whether the column is currently exposed in the generated DAB config.
         */
        isExposed: boolean;
    }

    export interface DabParameterConfig {
        name: string;
        dataType?: string;
        isRequired?: boolean;
        defaultValue?: string | number | boolean | null;
        description?: string;
    }

    export interface DabFieldConfig {
        name: string;
        alias?: string;
        description?: string;
        isPrimaryKey?: boolean;
    }

    export interface DabSourceObject {
        id: string;
        sourceType: EntitySourceType;
        schemaName: string;
        sourceName: string;
        columns: DabColumnConfig[];
        fields?: DabFieldConfig[];
        parameters?: DabParameterConfig[];
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
         * Source database object type.
         */
        sourceType?: EntitySourceType;
        /**
         * Source database object name.
         */
        sourceName?: string;
        /**
         * Table name. Kept for compatibility with existing table-only callers.
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
         * Field metadata for generated DAB config. Views use this to mark inferred keys.
         */
        fields?: DabFieldConfig[];
        /**
         * Stored procedure parameter metadata.
         */
        parameters?: DabParameterConfig[];
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

    export interface GetDatabaseObjectsResponse {
        sourceObjects: DabSourceObject[];
    }

    export namespace GetDatabaseObjectsRequest {
        export const type = new RequestType<void, GetDatabaseObjectsResponse, void>(
            "dab/getDatabaseObjects",
        );
    }

    /**
     * Entity reference for DAB tool operations.
     * Exactly one form is supported: id OR schemaName+tableName OR schemaName+sourceName+sourceType.
     */
    export type DabEntityRef =
        | { id: string }
        | { schemaName: string; tableName: string }
        | { schemaName: string; sourceName: string; sourceType: EntitySourceType };

    export type DabColumnRef = { id: string } | { name: string };

    export type DabEntitySettingsPatch = Partial<
        Omit<
            EntityAdvancedSettings,
            "customRestPath" | "customGraphQLType" | "storedProcedureRestMethods"
        >
    > & {
        customRestPath?: string | null;
        customGraphQLType?: string | null;
        storedProcedureRestMethods?: RestMethod[] | null;
    };

    export type DabToolChange =
        | { type: "set_api_types"; apiTypes: ApiType[] }
        | { type: "add_entity"; entity: DabEntityRef }
        | { type: "remove_entity"; entity: DabEntityRef }
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
     * Notification to add the generated config to the open workspace.
     */
    export interface AddConfigToWorkspaceParams {
        configContent: string;
    }

    export namespace AddConfigToWorkspaceNotification {
        export const type = new NotificationType<AddConfigToWorkspaceParams>(
            "dab/addConfigToWorkspace",
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

    function normalizeDataTypeName(dataType?: string): string | undefined {
        const normalized = dataType
            ?.trim()
            .toLowerCase()
            .replace(/[\[\]]/g, "")
            .replace(/\s*\(.*\)\s*$/, "");

        if (!normalized) {
            return undefined;
        }

        const unqualified = normalized.replace(/^sys\./, "");
        const sqlClrType = unqualified.replace(/^microsoft\.sqlserver\.types\.sql/, "");
        return sqlClrType === "timestamp" ? "rowversion" : sqlClrType;
    }

    const DAB_UNSUPPORTED_DATA_TYPE_NAMES = new Set(
        DAB_UNSUPPORTED_DATA_TYPES.map((dataType) => normalizeDataTypeName(dataType)).filter(
            (dataType): dataType is string => !!dataType,
        ),
    );

    function isUnsupportedDataType(dataType?: string): boolean {
        const normalized = normalizeDataTypeName(dataType);
        return !!normalized && DAB_UNSUPPORTED_DATA_TYPE_NAMES.has(normalized);
    }

    export function isDataTypeSupportedForDab(dataType?: string): boolean {
        return !isUnsupportedDataType(dataType);
    }

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

        const unsupportedColumns = columns.filter((c) => isUnsupportedDataType(c.dataType));
        if (unsupportedColumns.length > 0) {
            const details = unsupportedColumns.map((c) => `${c.name} (${c.dataType})`).join(", ");
            reasons.push({ type: "unsupportedDataTypes", columns: details });
        }

        return reasons.length > 0 ? { isSupported: false, reasons } : { isSupported: true };
    }

    export function validateSourceObjectForDab(sourceObject: DabSourceObject): {
        isSupported: boolean;
        reasons?: DabUnsupportedReason[];
    } {
        const reasons: DabUnsupportedReason[] = [];
        const hasPrimaryKey =
            sourceObject.sourceType === EntitySourceType.Table
                ? sourceObject.columns.some((c) => c.isPrimaryKey)
                : (sourceObject.fields ?? []).some((field) => field.isPrimaryKey);
        if (sourceObject.sourceType !== EntitySourceType.StoredProcedure && !hasPrimaryKey) {
            reasons.push({ type: "noPrimaryKey" });
        }

        const unsupportedColumns = [
            ...sourceObject.columns.filter((c) => isUnsupportedDataType(c.dataType)),
            ...(sourceObject.parameters ?? [])
                .filter((parameter) => isUnsupportedDataType(parameter.dataType))
                .map(
                    (parameter): DabColumnConfig => ({
                        id: parameter.name,
                        name: parameter.name,
                        dataType: parameter.dataType ?? "",
                        isPrimaryKey: false,
                        isSupported: false,
                        isExposed: true,
                    }),
                ),
        ];
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
        return isDataTypeSupportedForDab(column.dataType);
    }

    /**
     * Creates default column exposure configuration from a schema column.
     */
    export function createDefaultColumnConfig(column: SchemaDesigner.Column): DabColumnConfig {
        return {
            id: column.id,
            name: column.name,
            dataType: column.dataType,
            isPrimaryKey: column.isPrimaryKey,
            isSupported: isColumnSupportedForDab(column),
            isExposed: true,
        };
    }

    export function createSourceObjectFromTable(table: SchemaDesigner.Table): DabSourceObject {
        return {
            id: table.id,
            sourceType: EntitySourceType.Table,
            schemaName: table.schema,
            sourceName: table.name,
            columns: table.columns.map((column) => createDefaultColumnConfig(column)),
        };
    }

    export function createSchemaTablesFromSources(
        sourceObjects: DabSourceObject[],
    ): SchemaDesigner.Table[] {
        return sourceObjects
            .filter((source) => source.sourceType === EntitySourceType.Table)
            .map((source) => ({
                id: source.id,
                name: source.sourceName,
                schema: source.schemaName,
                columns: source.columns.map(
                    (column): SchemaDesigner.Column => ({
                        id: column.id,
                        name: column.name,
                        dataType: column.dataType,
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: column.isPrimaryKey,
                        isIdentity: false,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: !column.isPrimaryKey,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    }),
                ),
                foreignKeys: [],
            }));
    }

    /**
     * Creates default entity configuration from a schema table
     */
    export function createDefaultEntityConfig(table: SchemaDesigner.Table): DabEntityConfig {
        return createDefaultEntityConfigFromSource(createSourceObjectFromTable(table));
    }

    export function createDefaultEntityConfigFromSource(
        sourceObject: DabSourceObject,
    ): DabEntityConfig {
        const { isSupported, reasons } = validateSourceObjectForDab(sourceObject);
        const isStoredProcedure = sourceObject.sourceType === EntitySourceType.StoredProcedure;
        return {
            id: sourceObject.id,
            sourceType: sourceObject.sourceType,
            sourceName: sourceObject.sourceName,
            tableName: sourceObject.sourceName,
            schemaName: sourceObject.schemaName,
            isEnabled: isSupported,
            isSupported,
            unsupportedReasons: reasons,
            enabledActions: isStoredProcedure
                ? [EntityAction.Execute]
                : [
                      EntityAction.Create,
                      EntityAction.Read,
                      EntityAction.Update,
                      EntityAction.Delete,
                  ],
            columns: sourceObject.columns.map((column) => ({ ...column })),
            fields: sourceObject.fields?.map((field) => ({ ...field })),
            parameters: sourceObject.parameters?.map((parameter) => ({ ...parameter })),
            advancedSettings: {
                entityName: sourceObject.sourceName,
                authorizationRole: AuthorizationRole.Anonymous,
                ...(isStoredProcedure ? { exposeAsMcpCustomTool: true } : {}),
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

    function cloneFields(fields: DabFieldConfig[] | undefined): DabFieldConfig[] | undefined {
        return fields?.map((field) => ({ ...field }));
    }

    function cloneParameters(
        parameters: DabParameterConfig[] | undefined,
    ): DabParameterConfig[] | undefined {
        return parameters?.map((parameter) => ({ ...parameter }));
    }

    function cloneConfig(config: DabConfig): DabConfig {
        return {
            apiTypes: [...config.apiTypes],
            entities: config.entities.map((entity) => ({
                ...entity,
                enabledActions: [...entity.enabledActions],
                columns: cloneColumns(entity.columns),
                fields: cloneFields(entity.fields),
                parameters: cloneParameters(entity.parameters),
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
                isPrimaryKey: tableColumn.isPrimaryKey,
                isSupported: isColumnSupportedForDab(tableColumn),
            };

            if (
                existingColumn.name !== syncedColumn.name ||
                existingColumn.dataType !== syncedColumn.dataType ||
                existingColumn.isPrimaryKey !== syncedColumn.isPrimaryKey ||
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
        return syncEntityConfigWithSource(entity, createSourceObjectFromTable(table));
    }

    export function syncEntityConfigWithSource(
        entity: DabEntityConfig,
        sourceObject: DabSourceObject,
    ): DabEntityConfig {
        const { isSupported, reasons } = validateSourceObjectForDab(sourceObject);
        const syncedColumns =
            sourceObject.sourceType === EntitySourceType.StoredProcedure
                ? { columns: cloneColumns(sourceObject.columns), changed: false }
                : syncColumnsWithTable(
                      entity.columns,
                      sourceObject.columns.map(
                          (column) =>
                              ({
                                  id: column.id,
                                  name: column.name,
                                  dataType: column.dataType,
                                  isPrimaryKey: column.isPrimaryKey,
                              }) as SchemaDesigner.Column,
                      ),
                  );
        return {
            ...entity,
            id: sourceObject.id,
            sourceType: sourceObject.sourceType,
            sourceName: sourceObject.sourceName,
            tableName: sourceObject.sourceName,
            schemaName: sourceObject.schemaName,
            isSupported,
            unsupportedReasons: reasons,
            columns: syncedColumns.columns,
            fields: cloneFields(sourceObject.fields),
            parameters: cloneParameters(sourceObject.parameters),
            // Unsupported entities must remain disabled until the schema is fixed.
            isEnabled: !isSupported ? false : entity.isEnabled,
        };
    }

    export function syncConfigWithSources(
        currentConfig: DabConfig | null,
        sourceObjects: DabSourceObject[],
    ): { config: DabConfig; changed: boolean } {
        const allSourceObjects = sourceObjects;
        let changed = false;
        const normalizedConfig = currentConfig
            ? cloneConfig(currentConfig)
            : createDefaultConfigFromSources(allSourceObjects);
        if (!currentConfig) {
            changed = true;
        }

        const getSourceKey = (id: string): string => id.toLowerCase();
        const sourcesById = new Map(
            allSourceObjects.map((source) => [getSourceKey(source.id), source]),
        );
        const syncedEntities: DabEntityConfig[] = [];

        for (const entity of normalizedConfig.entities) {
            const sourceObject = sourcesById.get(getSourceKey(entity.id));
            if (!sourceObject) {
                changed = true;
                continue;
            }

            const syncedEntity = syncEntityConfigWithSource(entity, sourceObject);
            if (
                entity.tableName !== syncedEntity.tableName ||
                entity.id !== syncedEntity.id ||
                entity.sourceName !== syncedEntity.sourceName ||
                entity.sourceType !== syncedEntity.sourceType ||
                entity.schemaName !== syncedEntity.schemaName ||
                entity.isSupported !== syncedEntity.isSupported ||
                JSON.stringify(entity.columns) !== JSON.stringify(syncedEntity.columns) ||
                JSON.stringify(entity.fields) !== JSON.stringify(syncedEntity.fields) ||
                JSON.stringify(entity.parameters) !== JSON.stringify(syncedEntity.parameters) ||
                JSON.stringify(entity.unsupportedReasons) !==
                    JSON.stringify(syncedEntity.unsupportedReasons) ||
                entity.isEnabled !== syncedEntity.isEnabled
            ) {
                changed = true;
            }

            syncedEntities.push(syncedEntity);
            sourcesById.delete(getSourceKey(entity.id));
        }

        for (const sourceObject of allSourceObjects) {
            if (!sourcesById.has(getSourceKey(sourceObject.id))) {
                continue;
            }

            syncedEntities.push(createDefaultEntityConfigFromSource(sourceObject));
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

    export function syncConfigWithSchema(
        currentConfig: DabConfig | null,
        schemaTables: SchemaDesigner.Table[],
        sourceObjects?: DabSourceObject[],
    ): { config: DabConfig; changed: boolean } {
        return syncConfigWithSources(
            currentConfig,
            sourceObjects ?? schemaTables.map((table) => createSourceObjectFromTable(table)),
        );
    }

    /**
     * Creates default DAB configuration from schema tables
     */
    export function createDefaultConfig(tables: SchemaDesigner.Table[]): DabConfig {
        return createDefaultConfigFromSources(
            tables.map((table) => createSourceObjectFromTable(table)),
        );
    }

    export function createDefaultConfigFromSources(sourceObjects: DabSourceObject[]): DabConfig {
        return {
            apiTypes: [ApiType.Rest],
            entities: sourceObjects.map((sourceObject) =>
                createDefaultEntityConfigFromSource(sourceObject),
            ),
        };
    }
}
