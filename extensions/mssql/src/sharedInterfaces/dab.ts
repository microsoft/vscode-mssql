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
    // Local Container Deployment
    // ============================================

    /**
     * DAB container image from Microsoft Container Registry
     */
    export const DAB_CONTAINER_IMAGE = "mcr.microsoft.com/azure-databases/data-api-builder";

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
     * Status of an individual deployment step
     */
    export interface DabDeploymentStepStatus {
        /**
         * The step this status is for
         */
        step: DabDeploymentStepOrder;
        /**
         * Current status of the step
         */
        status: "notStarted" | "running" | "completed" | "error";
        /**
         * Error message if the step failed
         */
        errorMessage?: string;
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
                { step: DabDeploymentStepOrder.dockerInstallation, status: "notStarted" },
                { step: DabDeploymentStepOrder.startDockerDesktop, status: "notStarted" },
                { step: DabDeploymentStepOrder.checkDockerEngine, status: "notStarted" },
                { step: DabDeploymentStepOrder.pullImage, status: "notStarted" },
                { step: DabDeploymentStepOrder.startContainer, status: "notStarted" },
                { step: DabDeploymentStepOrder.checkContainer, status: "notStarted" },
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

        /**
         * Runs a specific DAB deployment step
         * @param step The deployment step to run
         * @param params Optional deployment parameters (container name, port)
         * @param config Optional DAB config (needed for startContainer step)
         * @param connectionString Optional connection string for generating config
         */
        runDeploymentStep(
            step: DabDeploymentStepOrder,
            params?: DabDeploymentParams,
            config?: DabConfig,
            connectionString?: string,
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
