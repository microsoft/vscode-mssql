/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as mssql from "vscode-mssql";
import * as constants from "../constants/constants";
import { FormWebviewController } from "../forms/formWebviewController";
import VscodeWrapper from "../controllers/vscodeWrapper";
import ConnectionManager, { ConnectionSuccessfulEvent } from "../controllers/connectionManager";
import { IConnectionProfile } from "../models/interfaces";
import { PublishProject as Loc } from "../constants/locConstants";
import {
    PublishDialogReducers,
    PublishDialogFormItemSpec,
    IPublishForm,
    PublishFormFields,
    PublishFormContainerFields,
    PublishDialogState,
    PublishTarget,
    GenerateSqlPackageCommandRequest,
} from "../sharedInterfaces/publishDialog";
import { SqlPackageService } from "../languageservice/sqlPackageService";
import { sendActionEvent, sendErrorEvent } from "../telemetry/telemetry";
import { generatePublishFormComponents } from "./formComponentHelpers";
import {
    parsePublishProfileXml,
    readProjectProperties,
    validateSqlCmdVariables,
    getSqlServerContainerTagsForTargetVersion,
} from "./projectUtils";
import { SqlProjectsService } from "../services/sqlProjectsService";
import { Deferred } from "../protocol";
import { TelemetryViews, TelemetryActions } from "../sharedInterfaces/telemetry";
import { TaskExecutionMode } from "../sharedInterfaces/schemaCompare";
import { hasAnyMissingRequiredValues, getErrorMessage } from "../utils/utils";
import { ConnectionCredentials } from "../models/connectionCredentials";
import * as Utils from "../models/utils";
import { ProjectController } from "../controllers/projectController";
import { generateOperationId } from "../schemaCompare/schemaCompareUtils";
import { UserSurvey } from "../nps/userSurvey";
import * as dockerUtils from "../deployment/dockerUtils";
import { DockerConnectionProfile, DockerStepOrder } from "../sharedInterfaces/localContainers";
import MainController from "../controllers/mainController";
import { localhost, sa, sqlAuthentication, azureMfa } from "../constants/constants";

const SQLPROJ_PUBLISH_VIEW_ID = "publishProject";

export class PublishProjectWebViewController extends FormWebviewController<
    IPublishForm,
    PublishDialogState,
    PublishDialogFormItemSpec,
    PublishDialogReducers
> {
    private _cachedDatabaseList?: { displayName: string; value: string }[];
    private _cachedSelectedDatabase?: string;
    private _connectionUri?: string;
    private _connectionString?: string;
    public readonly initialized: Deferred<void> = new Deferred<void>();
    private readonly _sqlProjectsService?: SqlProjectsService;
    private readonly _dacFxService?: mssql.IDacFxService;
    private readonly _sqlPackageService?: SqlPackageService;
    private readonly _connectionManager: ConnectionManager;
    private readonly _projectController: ProjectController;
    private readonly _mainController: MainController;
    private readonly _operationId: string;

    constructor(
        context: vscode.ExtensionContext,
        _vscodeWrapper: VscodeWrapper,
        connectionManager: ConnectionManager,
        projectFilePath: string,
        mainController: MainController,
        sqlProjectsService?: SqlProjectsService,
        dacFxService?: mssql.IDacFxService,
        sqlPackageService?: SqlPackageService,
        deploymentOptions?: mssql.DeploymentOptions,
    ) {
        super(
            context,
            _vscodeWrapper,
            "publishProject",
            "publishProject",
            {
                formState: {
                    publishProfilePath: "",
                    serverName: "",
                    databaseName: path.basename(projectFilePath, path.extname(projectFilePath)),
                    publishTarget: PublishTarget.ExistingServer,
                    sqlCmdVariables: {},
                },
                formComponents: {},
                projectFilePath,
                inProgress: false,
                lastPublishResult: undefined,
                hasFormErrors: true,
                deploymentOptions: deploymentOptions,
                defaultDeploymentOptions: deploymentOptions
                    ? structuredClone(deploymentOptions)
                    : undefined,
                waitingForNewConnection: false,
            } as PublishDialogState,
            {
                title: Loc.Title,
                viewColumn: vscode.ViewColumn.Active,
                iconPath: {
                    dark: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "publishProject_dark.svg",
                    ),
                    light: vscode.Uri.joinPath(
                        context.extensionUri,
                        "media",
                        "publishProject_light.svg",
                    ),
                },
            },
        );

        // Clear default excludeObjectTypes for publish dialog, no default exclude options should exist
        if (deploymentOptions?.excludeObjectTypes !== undefined) {
            deploymentOptions.excludeObjectTypes.value = [];
        }

        this._sqlProjectsService = sqlProjectsService;
        this._dacFxService = dacFxService;
        this._sqlPackageService = sqlPackageService;
        this._connectionManager = connectionManager;
        this._projectController = new ProjectController();
        this._mainController = mainController;
        this._operationId = generateOperationId();

        // Send telemetry for dialog opened
        sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.PublishDialogOpened, {
            operationId: this._operationId,
        });

        this.registerRpcHandlers();

        // Listen for successful connections
        this.registerDisposable(
            this._connectionManager.onSuccessfulConnection(async (event) => {
                // Only auto-populate if waiting for a new connection
                if (this.state.waitingForNewConnection) {
                    // Auto-populate form fields from the successful connection event
                    await this.handleSuccessfulConnection(event);
                }
            }),
        );

        void this.initializeDialog(projectFilePath)
            .then(() => {
                this.updateState();
                this.initialized.resolve();
            })
            .catch((err) => {
                this.initialized.reject(err);
            });
    }

    /**
     * Builds the SQL project and returns the DACPAC path
     * @param state Current dialog state
     * @returns Path to the built DACPAC file, or undefined if build fails
     */
    private async buildProject(state: PublishDialogState): Promise<string | undefined> {
        try {
            const dacpacPath = await this._projectController.buildProject(state.projectProperties);
            return dacpacPath;
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.BuildProject,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );
            return undefined;
        }
    }

    /**
     * Publishes the DACPAC to the target database
     * @param state Current dialog state
     * @param dacpacPath Path to the DACPAC file
     * @param databaseName Target database name
     * @param upgradeExisting Whether to upgrade an existing database
     */
    private async publishToDatabase(
        state: PublishDialogState,
        dacpacPath: string,
        databaseName: string,
        upgradeExisting: boolean,
    ): Promise<void> {
        const connectionUri = this._connectionUri || "";
        const sqlCmdVariables = new Map(Object.entries(state.formState.sqlCmdVariables || {}));

        // Send telemetry
        sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.PublishProject, {
            operationId: this._operationId,
        });

        try {
            const result = await this._dacFxService!.deployDacpac(
                dacpacPath,
                databaseName,
                upgradeExisting,
                connectionUri,
                TaskExecutionMode.execute,
                sqlCmdVariables,
                state.deploymentOptions,
            );

            if (result.success) {
                sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.PublishProject, {
                    operationId: this._operationId,
                    success: "true",
                });
                // Prompt user for NPS feedback after successful publish
                void UserSurvey.getInstance().promptUserForNPSFeedback(SQLPROJ_PUBLISH_VIEW_ID);
            } else {
                sendErrorEvent(
                    TelemetryViews.SqlProjects,
                    TelemetryActions.PublishProject,
                    new Error(getErrorMessage(result.errorMessage)),
                    false,
                );
            }
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.PublishProject,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );
        }
    }

    /**
     * Generates a deployment script for the DACPAC
     * @param state Current dialog state
     * @param dacpacPath Path to the DACPAC file
     * @param databaseName Target database name
     */
    private async generateDeploymentScript(
        state: PublishDialogState,
        dacpacPath: string,
        databaseName: string,
    ): Promise<void> {
        const connectionUri = this._connectionUri || "";
        const sqlCmdVariables = new Map(Object.entries(state.formState.sqlCmdVariables || {}));

        // Send telemetry
        sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.GenerateScript, {
            operationId: this._operationId,
        });

        try {
            const result = await this._dacFxService!.generateDeployScript(
                dacpacPath,
                databaseName,
                connectionUri,
                TaskExecutionMode.script,
                sqlCmdVariables,
                state.deploymentOptions,
            );

            if (result.success) {
                sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.GenerateScript, {
                    operationId: this._operationId,
                    success: "true",
                });
            }
        } catch (error) {
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.GenerateScript,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );
        }
    }

    /**
     * Determines if the target database already exists
     * @param state Current dialog state
     * @param databaseName Target database name
     * @returns True if database exists, false otherwise
     */
    private isDatabaseExisting(state: PublishDialogState, databaseName: string): boolean {
        if (state.formState.publishTarget === PublishTarget.ExistingServer && this._connectionUri) {
            const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];
            if (databaseComponent?.options) {
                return databaseComponent.options.some((option) => option.value === databaseName);
            }
        } else if (state.formState.publishTarget === PublishTarget.LocalContainer) {
            return false;
        }
        return true;
    }

    /**
     * Executes publish and generate script operations
     * @param state Current dialog state
     * @param isPublish If true, publishes to database; if false, generates script
     */
    private async executePublishAndGenerateScript(
        state: PublishDialogState,
        isPublish: boolean,
    ): Promise<void> {
        const databaseName = state.formState.databaseName;

        // Step 1: Build the project
        const dacpacPath = await this.buildProject(state);
        if (!dacpacPath) {
            return;
        }

        // Step 2: Determine if database exists
        const upgradeExisting = this.isDatabaseExisting(state, databaseName);

        // Step 3: Execute publish or generate script
        if (isPublish) {
            await this.publishToDatabase(state, dacpacPath, databaseName, upgradeExisting);
        } else {
            await this.generateDeploymentScript(state, dacpacPath, databaseName);
        }
    }

    /**
     * Step 1: Runs Docker prerequisite checks (install, start, engine).
     * Must pass before proceeding with container creation.
     * @returns Success flag and optional error message if failed
     */
    private async runDockerPrerequisiteChecks(): Promise<{
        success: boolean;
        error?: string;
    }> {
        const dockerSteps = dockerUtils.initializeDockerSteps();
        const dummyProfile = {} as DockerConnectionProfile;

        // Run prerequisite steps up to and including checkDockerEngine
        for (let stepIndex = 0; stepIndex <= DockerStepOrder.checkDockerEngine; stepIndex++) {
            const currentStep = dockerSteps[stepIndex];
            const args = currentStep.argNames.map(
                (argName) => (dummyProfile as unknown as Record<string, unknown>)[argName],
            );
            const result = await currentStep.stepAction(...args);

            if (!result.success) {
                return {
                    success: false,
                    error: result.error,
                };
            }

            // Show success message matching deployment UI format
            void vscode.window.showInformationMessage(`✓ ${currentStep.headerText}`);
        }

        return { success: true };
    }

    /**
     * Step 2: Prepares container configuration values.
     * Form validation already ensures password, port, and EULA are valid.
     * This step generates container name and parses port number.
     * @param state Current publish dialog state
     * @returns Configuration values ready for container creation
     */
    private async prepareContainerConfiguration(state: PublishDialogState): Promise<{
        containerName: string;
        port: number;
    }> {
        // Auto-generate unique container name
        const containerName = await dockerUtils.validateContainerName("");

        // Parse port (already validated by form)
        const port = parseInt(state.formState.containerPort);

        return { containerName, port };
    }

    /**
     * Step 3: Creates Docker container using validated configuration.
     * Runs steps 3-6: pull image, start container, check ready, connect.
     * @param validatedContainerName - Validated unique container name
     * @param validatedPort - Validated available port
     * @param state Current publish dialog state
     * @returns Connection URI if successful, error info if failed
     */
    private async createDockerContainer(
        validatedContainerName: string,
        validatedPort: number,
        state: PublishDialogState,
    ): Promise<{
        success: boolean;
        connectionUri?: string;
        error?: string;
        fullErrorText?: string;
    }> {
        // Build Docker profile using validated values
        const dockerProfile = {
            version: state.formState.containerImageTag || "",
            password: state.formState.containerAdminPassword || "",
            containerName: validatedContainerName,
            port: validatedPort,
            hostname: "",
            profileName: validatedContainerName,
            savePassword: true,
            acceptEula: state.formState.acceptContainerLicense || false,
        } as unknown as DockerConnectionProfile;

        const dockerSteps = dockerUtils.initializeDockerSteps();

        // Execute container creation steps: from pullImage to checkContainer
        // Dynamic iteration ensures we don't miss any steps added in the future
        for (
            let stepIndex = DockerStepOrder.pullImage;
            stepIndex <= DockerStepOrder.checkContainer;
            stepIndex++
        ) {
            const currentStep = dockerSteps[stepIndex];
            const args = currentStep.argNames.map(
                (argName) => (dockerProfile as unknown as Record<string, unknown>)[argName],
            );
            const result = await currentStep.stepAction(...args);

            if (!result.success) {
                return {
                    success: false,
                    error: result.error,
                    fullErrorText: result.fullErrorText,
                };
            }

            // Show success message matching deployment UI format
            void vscode.window.showInformationMessage(`✓ ${currentStep.headerText}`);
        }

        // Register connection gives us a real connection URI that can be used for DacFx operations
        const connectionProfile = {
            server: `${localhost},${validatedPort}`,
            profileName: validatedContainerName,
            savePassword: true,
            emptyPasswordInput: false,
            authenticationType: sqlAuthentication,
            user: sa,
            password: dockerProfile.password,
            trustServerCertificate: true,
        } as IConnectionProfile;

        try {
            // Save the connection profile to VS Code settings
            const savedProfile =
                await this._mainController.connectionManager.connectionUI.saveProfile(
                    connectionProfile,
                );

            // Open in Object Explorer (this also establishes the connection)
            await this._mainController.createObjectExplorerSession(savedProfile);

            // Get the connection URI from the saved profile
            const connectionUri =
                this._mainController.connectionManager.getUriForConnection(savedProfile);

            // Send telemetry for successful container creation and connection
            sendActionEvent(TelemetryViews.SqlProjects, TelemetryActions.ConnectToContainer, {
                operationId: this._operationId,
                publishTarget: PublishTarget.LocalContainer,
                success: "true",
            });

            return {
                success: true,
                connectionUri: connectionUri,
            };
        } catch (error) {
            // Send telemetry for connection failure
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.ConnectToContainer,
                error instanceof Error ? error : new Error(getErrorMessage(error)),
                false,
            );

            return {
                success: false,
                error: getErrorMessage(error),
            };
        }
    }

    private async initializeDialog(projectFilePath: string) {
        if (projectFilePath) {
            this.state.projectFilePath = projectFilePath;
        }

        // Get the project properties from the proj file
        let projectTargetVersion: string | undefined;
        try {
            if (this._sqlProjectsService && projectFilePath) {
                const props = await readProjectProperties(
                    this._sqlProjectsService,
                    projectFilePath,
                );
                if (props) {
                    this.state.projectProperties = props;
                    projectTargetVersion = props.targetVersion;
                }

                // Load SQLCMD variables from the project
                const sqlCmdVarsResult =
                    await this._sqlProjectsService.getSqlCmdVariables(projectFilePath);
                if (sqlCmdVarsResult?.success && sqlCmdVarsResult.sqlCmdVariables) {
                    // Convert array to object for form state
                    const sqlCmdVarsObject: { [key: string]: string } = {};
                    for (const sqlCmdVar of sqlCmdVarsResult.sqlCmdVariables) {
                        // Use the defaultValue which contains the actual values, not variable references like $(SqlCmdVar__1)
                        const varValue = sqlCmdVar.defaultValue || "";
                        sqlCmdVarsObject[sqlCmdVar.varName] = varValue;
                    }
                    this.state.formState.sqlCmdVariables = sqlCmdVarsObject;

                    // Store immutable default values (project defaults initially)
                    this.state.defaultSqlCmdVariables = { ...sqlCmdVarsObject };
                }
            }
        } catch (error) {
            // Log error and send telemetry, but keep dialog resilient
            this.logger.error("Failed to read project properties:", error);
            sendErrorEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.PublishProjectProperties,
                error instanceof Error ? error : new Error(String(error)),
                false,
            );
        }

        // Load publish form components
        this.state.formComponents = generatePublishFormComponents(
            projectTargetVersion,
            this.state.formState.databaseName,
        );

        // Fetch Docker tags for the container image dropdown
        const tagComponent = this.state.formComponents[PublishFormFields.ContainerImageTag];
        if (tagComponent) {
            try {
                const tagOptions =
                    await getSqlServerContainerTagsForTargetVersion(projectTargetVersion);
                tagComponent.options = tagOptions;
                if (!this.state.formState.containerImageTag && tagOptions.length > 0) {
                    this.state.formState.containerImageTag = tagOptions[0].value;
                }
            } catch (error) {
                this.state.formMessage = {
                    message: Loc.FailedToFetchContainerTags(getErrorMessage(error)),
                    intent: "error",
                };
            }
        }

        // Update item visibility before updating state to ensure SQLCMD table is visible if needed
        await this.updateItemVisibility();

        this.updateState();

        // Run initial validation to set hasFormErrors state for button enablement
        await this.validateForm(this.state.formState, undefined, true);
    }

    private registerRpcHandlers(): void {
        this.registerReducer("openConnectionDialog", async (state: PublishDialogState) => {
            // Set waiting state to detect new connections
            state.waitingForNewConnection = true;
            this.updateState(state);

            // Execute the command to open the connection dialog
            void vscode.commands.executeCommand(constants.cmdAddObjectExplorer);

            return state;
        });

        this.registerReducer("publishNow", async (state: PublishDialogState) => {
            // Check if publishing to local container
            if (state.formState.publishTarget === PublishTarget.LocalContainer) {
                // Keep panel open to show progress through all steps
                state.inProgress = true;
                this.updateState(state);

                try {
                    // STEP 1: Run Docker prerequisite checks (Docker install, start, engine)
                    const prereqResult = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: Loc.CheckingDockerPrerequisites,
                            cancellable: false,
                        },
                        async () => {
                            return await this.runDockerPrerequisiteChecks();
                        },
                    );

                    if (!prereqResult.success) {
                        sendErrorEvent(
                            TelemetryViews.SqlProjects,
                            TelemetryActions.PublishDialogLocalContainersPrerequisites,
                            new Error(prereqResult.error),
                            false,
                        );
                        state.formMessage = {
                            message: prereqResult.error,
                            intent: "error",
                        };
                        state.inProgress = false;
                        this.updateState(state);
                        return state;
                    }

                    // STEP 2: Prepare container configuration (generate name, parse port)
                    // Form validation already ensured password, port, and EULA are valid
                    const config = await this.prepareContainerConfiguration(state);

                    // STEP 3: Create Docker container (pull, start, check, connect)
                    const containerResult = await vscode.window.withProgress(
                        {
                            location: vscode.ProgressLocation.Notification,
                            title: Loc.CreatingSqlServerContainer,
                            cancellable: false,
                        },
                        async () => {
                            return await this.createDockerContainer(
                                config.containerName,
                                config.port,
                                state,
                            );
                        },
                    );

                    if (!containerResult.success) {
                        sendErrorEvent(
                            TelemetryViews.SqlProjects,
                            TelemetryActions.PublishDialogCreateLocalContainers,
                            new Error(containerResult.fullErrorText || containerResult.error),
                            false,
                        );
                        state.formMessage = {
                            message: containerResult.fullErrorText || containerResult.error,
                            intent: "error",
                        };
                        state.inProgress = false;
                        this.updateState(state);
                        return state;
                    }

                    // STEP 4: Store connection URI for DacFx publish
                    this._connectionUri = containerResult.connectionUri;

                    // STEP 5: Build DACPAC from project
                    const dacpacPath = await this.buildProject(state);
                    if (!dacpacPath) {
                        // Note: buildProject already sends its own telemetry on failure
                        state.inProgress = false;
                        this.updateState(state);
                        return state;
                    }

                    // STEP 6: Publish DACPAC to container using existing DacFx API
                    await this.publishToDatabase(
                        state,
                        dacpacPath,
                        state.formState.databaseName,
                        false,
                    );

                    state.inProgress = false;
                    this.panel?.dispose();
                } catch (error) {
                    this.logger.error("Failed during container publish:", error);
                    sendErrorEvent(
                        TelemetryViews.SqlProjects,
                        TelemetryActions.PublishProject,
                        error instanceof Error ? error : new Error(getErrorMessage(error)),
                        false,
                    );
                    state.formMessage = {
                        message: getErrorMessage(error),
                        intent: "error",
                    };
                    state.inProgress = false;
                    this.updateState(state);
                }

                return state;
            } else {
                this.panel?.dispose();
                void this.executePublishAndGenerateScript(state, true);
                return state;
            }
        });

        this.registerReducer("generatePublishScript", async (state) => {
            this.panel?.dispose();
            void this.executePublishAndGenerateScript(state, false);

            return state;
        });

        this.registerReducer(
            "updateDeploymentOptions",
            async (
                state: PublishDialogState,
                payload: { deploymentOptions: mssql.DeploymentOptions },
            ) => {
                // Update deployment options and regenerate grouped options for UI
                const newState = {
                    ...state,
                    deploymentOptions: payload.deploymentOptions,
                };

                return newState;
            },
        );

        this.registerReducer("selectPublishProfile", async (state: PublishDialogState) => {
            // Derive project folder path from the project file path
            const projectFolderPath = state.projectFilePath
                ? path.dirname(state.projectFilePath)
                : undefined;

            // Open browse dialog to select the publish.xml file
            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: false,
                defaultUri: projectFolderPath ? vscode.Uri.file(projectFolderPath) : undefined,
                openLabel: Loc.SelectPublishProfile,
                filters: {
                    [Loc.PublishSettingsFile]: [constants.PublishProfileExtension],
                },
            });

            if (fileUris?.length > 0) {
                const selectedPath = fileUris[0].fsPath;

                try {
                    // Parse the profile XML to extract all values, including deployment options from DacFx service
                    const parsedProfile = await parsePublishProfileXml(
                        selectedPath,
                        this._dacFxService,
                    );

                    // Send telemetry for profile loaded
                    sendActionEvent(
                        TelemetryViews.SqlProjects,
                        TelemetryActions.PublishProfileLoaded,
                        {
                            operationId: this._operationId,
                        },
                    );

                    // Merge SQLCMD variables: start with current values, then overlay profile variables
                    const mergedSqlCmdVariables = {
                        ...state.formState.sqlCmdVariables,
                        ...parsedProfile.sqlCmdVariables,
                    };

                    // Update immutable default values: project defaults + profile overrides
                    const updatedDefaults = {
                        ...state.defaultSqlCmdVariables,
                        ...parsedProfile.sqlCmdVariables,
                    };

                    // Update state with loaded profile data
                    this.state = {
                        ...state,
                        defaultSqlCmdVariables: updatedDefaults,
                        formState: {
                            ...state.formState,
                            publishProfilePath: selectedPath,
                            databaseName:
                                parsedProfile.databaseName || state.formState.databaseName,
                            serverName: parsedProfile.serverName || state.formState.serverName,
                            sqlCmdVariables: mergedSqlCmdVariables,
                        },
                        deploymentOptions:
                            parsedProfile.deploymentOptions || state.deploymentOptions,
                        formMessage: !this._dacFxService
                            ? {
                                  message: Loc.DacFxServiceNotAvailableProfileLoaded,
                                  intent: "error",
                              }
                            : undefined,
                    };

                    // Validate form after loading profile to update button states
                    await this.validateForm(this.state.formState, undefined, false);

                    // Update item visibility to show SQLCMD variables table if variables exist
                    await this.updateItemVisibility();

                    // Update UI immediately with profile data
                    this.updateState();

                    // If profile has a connection string, connect in background (non-blocking)
                    if (parsedProfile.connectionString) {
                        void this.connectAndPopulateDatabases(parsedProfile.connectionString).then(
                            (connectionResult) => {
                                // Update connection fields after background connection completes
                                this._connectionUri =
                                    connectionResult.connectionUri || this._connectionUri;
                                this._connectionString =
                                    connectionResult.connectionString || this._connectionString;
                                if (connectionResult.errorMessage) {
                                    this.state.formMessage = {
                                        message: Loc.ProfileLoadedConnectionFailed(
                                            this.state.formState.serverName,
                                        ),
                                        intent: "error",
                                    };
                                }
                                this.updateState();
                            },
                        );
                    }

                    return this.state;
                } catch (error) {
                    return {
                        ...state,
                        formMessage: {
                            message: `${Loc.PublishProfileLoadFailed}: ${error}`,
                            intent: "error",
                        },
                    };
                }
            }

            return state;
        });

        this.registerReducer("closeMessage", async (state: PublishDialogState) => {
            return { ...state, formMessage: undefined };
        });

        // Dedicated reducer for updating SQLCMD variables.
        // Cannot use formAction because FormEvent.value is typed as string | boolean,
        // but sqlCmdVariables is an object type, so we need a custom reducer for type safety.
        this.registerReducer(
            "updateSqlCmdVariables",
            async (
                state: PublishDialogState,
                payload: { variables: { [key: string]: string } },
            ) => {
                state.formState.sqlCmdVariables = payload.variables;
                return state;
            },
        );

        this.registerReducer("revertSqlCmdVariables", async (state: PublishDialogState) => {
            state.formState.sqlCmdVariables = { ...state.defaultSqlCmdVariables };
            return state;
        });

        this.registerReducer(
            "savePublishProfile",
            async (state: PublishDialogState, _payload: { publishProfileName: string }) => {
                // Derive project folder path and name from the project file path
                const projectFolderPath = state.projectFilePath
                    ? path.dirname(state.projectFilePath)
                    : ".";
                const projectName = state.projectFilePath
                    ? path.basename(state.projectFilePath, path.extname(state.projectFilePath))
                    : "project";

                // Use selected profile path if available, otherwise save as projectName
                const defaultPath = state.formState.publishProfilePath
                    ? vscode.Uri.file(state.formState.publishProfilePath)
                    : vscode.Uri.file(
                          path.join(
                              projectFolderPath,
                              `${projectName}.${constants.PublishProfileExtension}`,
                          ),
                      );

                // Open save dialog with default name
                const fileUri = await vscode.window.showSaveDialog({
                    defaultUri: defaultPath,
                    saveLabel: Loc.SaveAs,
                    filters: {
                        [Loc.PublishSettingsFile]: [constants.PublishProfileExtension],
                    },
                });

                if (!fileUri) {
                    return state; // User cancelled
                }

                // Save the profile using DacFx service
                if (!this._dacFxService) {
                    return {
                        ...state,
                        formMessage: {
                            message: Loc.DacFxServiceNotAvailable,
                            intent: "error",
                        },
                    };
                }

                try {
                    const databaseName = state.formState.databaseName || projectName;
                    // Connection string depends on publish target:
                    // - For container targets: empty string because we're provisioning a new container
                    //   and don't have an existing connection. The actual connection would be established
                    //   after the container is created and SQL Server is running inside it.
                    // - For existing servers: use the current connection string from the established connection
                    const connectionString =
                        state.formState.publishTarget === PublishTarget.LocalContainer
                            ? ""
                            : this._connectionString || "";
                    const sqlCmdVariables = new Map(
                        Object.entries(state.formState.sqlCmdVariables || {}),
                    );

                    await this._dacFxService.savePublishProfile(
                        fileUri.fsPath,
                        databaseName,
                        connectionString,
                        sqlCmdVariables,
                        state.deploymentOptions,
                    );

                    sendActionEvent(
                        TelemetryViews.SqlProjects,
                        TelemetryActions.PublishProfileSaved,
                        {
                            operationId: this._operationId,
                        },
                    );

                    return {
                        ...state,
                        formMessage: {
                            message: Loc.PublishProfileSavedSuccessfully(fileUri.fsPath),
                            intent: "success",
                        },
                    };
                } catch (error) {
                    return {
                        ...state,
                        formMessage: {
                            message: `${Loc.PublishProfileSaveFailed}: ${error}`,
                            intent: "error",
                        },
                    };
                }
            },
        );

        // Request handler to generate sqlpackage command string
        this.onRequest(GenerateSqlPackageCommandRequest.type, async () => {
            try {
                const dacpacPath = this.state.projectProperties?.dacpacOutputPath;

                if (!dacpacPath) {
                    throw new Error("DACPAC path not found. Please build the project first.");
                }

                // Build arguments object matching CommandLineArguments structure expected by backend
                const commandLineArguments: { [key: string]: string } = {
                    SourceFile: dacpacPath,
                };

                // Pass connection string if available, otherwise pass server and database name
                if (this._connectionString) {
                    commandLineArguments.TargetConnectionString = this._connectionString;
                } else {
                    // Fallback to server and database name when connection string is not yet available
                    // (e.g., when profile is loading connection in background)
                    if (this.state.formState.serverName) {
                        commandLineArguments.TargetServerName = this.state.formState.serverName;
                    }
                    if (this.state.formState.databaseName) {
                        commandLineArguments.TargetDatabaseName = this.state.formState.databaseName;
                    }
                }

                // Pass publish profile path if available
                if (this.state.formState.publishProfilePath) {
                    commandLineArguments.Profile = this.state.formState.publishProfilePath;
                }

                // Serialize arguments as JSON (backend deserializes with PropertyNameCaseInsensitive)
                const serializedArguments = JSON.stringify(commandLineArguments);

                // Call SQL Tools Service to generate the command
                // Backend will handle all formatting, quoting, and command construction
                const result = await this._sqlPackageService.generateSqlPackageCommand({
                    action: "Publish" as mssql.CommandLineToolAction,
                    arguments: serializedArguments,
                    deploymentOptions: this.state.deploymentOptions,
                    variables: this.state.formState.sqlCmdVariables,
                });

                if (!result.success) {
                    // Return error message instead of throwing, so it can be displayed in the dialog
                    return Loc.FailedToGenerateSqlPackageCommand(result.errorMessage);
                }

                return result.command || "";
            } catch (error) {
                // Return error message for unexpected errors
                return Loc.FailedToGenerateSqlPackageCommand(getErrorMessage(error));
            }
        });
    }

    /**
     * Connects to SQL Server using a connection string and populates the database dropdown.
     * This happens in the background when loading a publish profile.
     * @param connectionString The connection string from the publish profile
     * @returns Object containing connectionUri and connectionString if successful, or errorMessage if failed
     */
    private async connectAndPopulateDatabases(connectionString: string): Promise<{
        connectionUri?: string;
        connectionString?: string;
        errorMessage?: string;
    }> {
        const fileUri = `mssql://publish-profile-${Utils.generateGuid()}`;

        try {
            // Parse connection string and connect
            const connectionDetails =
                await this._connectionManager.parseConnectionString(connectionString);
            const connectionInfo = ConnectionCredentials.createConnectionInfo(connectionDetails);

            // Ensure accountId is present for Azure MFA connections before connecting
            let profileMatched = true;
            if (connectionInfo.authenticationType === azureMfa && !connectionInfo.accountId) {
                profileMatched =
                    await this._connectionManager.ensureAccountIdForAzureMfa(connectionInfo);
                if (!profileMatched) {
                    this.logger.warn(
                        `Could not find accountId for Azure MFA connection when loading publish profile`,
                    );
                    throw new Error(Loc.ProfileLoadedConnectionFailed(connectionInfo.server));
                }
            }

            await this._connectionManager.connect(fileUri, connectionInfo, {
                shouldHandleErrors: false,
            });

            // Get and populate database list
            const databases = await this._connectionManager.listDatabases(fileUri);
            const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];
            if (databaseComponent && databases) {
                databaseComponent.options = databases.map((db) => ({
                    displayName: db,
                    value: db,
                }));
            }

            // Get connection string for SqlPackage command generation and saving to publish profile
            const retrievedConnectionString = await this._connectionManager.getConnectionString(
                fileUri,
                true, // includePassword
                true, // includeApplicationName
            );

            return { connectionUri: fileUri, connectionString: retrievedConnectionString };
        } catch (error) {
            return { errorMessage: getErrorMessage(error) };
        }
    }

    /**
     * Handle successful connection event and populate form fields with connection details, such as server name and database list.
     * @param event The connection successful event containing connection details
     */
    private async handleSuccessfulConnection(event: ConnectionSuccessfulEvent): Promise<void> {
        try {
            const connection = event.connection;
            if (!connection || !connection.credentials) {
                return;
            }

            const connectionProfile = connection.credentials as IConnectionProfile;
            if (!connectionProfile || !connectionProfile.server) {
                return;
            }

            this.state.formState.serverName = connectionProfile.server;

            // Store the connectionUri and connection string for dacfx operations and saving to publish profile
            this._connectionUri = event.fileUri;
            this._connectionString = await this._connectionManager.getConnectionString(
                event.fileUri,
                true, // includePassword
                true, // includeApplicationName
            );

            // Get databases
            try {
                const databases = await this._connectionManager.listDatabases(event.fileUri);

                // Update database dropdown options
                const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];
                if (databaseComponent) {
                    databaseComponent.options = databases.map((db) => ({
                        displayName: db,
                        value: db,
                    }));
                }

                // Optionally select the first database if available
                if (databases.length > 0 && !this.state.formState.databaseName) {
                    this.state.formState.databaseName = databases[0];
                }
            } catch (dbError) {
                // Show error message to user when database listing fails
                this.state.formMessage = {
                    message: `${Loc.FailedToListDatabases}: ${getErrorMessage(dbError)}`,
                    intent: "error",
                };

                // Log the error for diagnostics
                sendActionEvent(
                    TelemetryViews.SqlProjects,
                    TelemetryActions.PublishProjectConnectionError,
                    {
                        operationId: this._operationId,
                    },
                );
            }

            // Validate form to update button state after connection
            await this.validateForm(this.state.formState, undefined, false);
        } catch {
            // Log the error for diagnostics
            sendActionEvent(
                TelemetryViews.SqlProjects,
                TelemetryActions.PublishProjectConnectionError,
                {
                    operationId: this._operationId,
                },
            );
        } finally {
            // Reset the waiting state
            this.state.waitingForNewConnection = false;

            // Update UI to reflect all state changes (connection success, errors, and waiting state reset)
            this.updateState();
        }
    }

    protected getActiveFormComponents(state: PublishDialogState): (keyof IPublishForm)[] {
        const activeComponents: (keyof IPublishForm)[] = [
            PublishFormFields.PublishTarget,
            PublishFormFields.PublishProfilePath,
            PublishFormFields.ServerName,
            PublishFormFields.DatabaseName,
        ];

        if (state.formState.publishTarget === PublishTarget.LocalContainer) {
            activeComponents.push(...PublishFormContainerFields);
        }

        return activeComponents;
    }

    /**
     * Called after a form property is set and validated.
     * Handles publish target changes for both validation and database dropdown management.
     */
    public async afterSetFormProperty(propertyName: keyof IPublishForm): Promise<void> {
        if (propertyName === PublishFormFields.PublishTarget) {
            const databaseComponent = this.state.formComponents[PublishFormFields.DatabaseName];
            if (!databaseComponent) return;

            if (this.state.formState.publishTarget === PublishTarget.LocalContainer) {
                // Cache and clear for container mode
                if (databaseComponent.options?.length) {
                    this._cachedDatabaseList = databaseComponent.options;
                    this._cachedSelectedDatabase = this.state.formState.databaseName;
                }
                databaseComponent.options = [];
                this.state.formState.databaseName = path.basename(
                    this.state.projectFilePath,
                    path.extname(this.state.projectFilePath),
                );
                this._connectionUri = undefined;
                this._connectionString = undefined;
            } else if (this.state.formState.publishTarget === PublishTarget.ExistingServer) {
                // Restore for server mode
                if (this._cachedDatabaseList?.length) {
                    databaseComponent.options = this._cachedDatabaseList;
                    if (this._cachedSelectedDatabase) {
                        this.state.formState.databaseName = this._cachedSelectedDatabase;
                    }
                }
            }

            await this.updateItemVisibility();
            await this.validateForm(this.state.formState, undefined, false);
            this.updateState();
        }
    }

    public updateItemVisibility(state?: PublishDialogState): Promise<void> {
        const currentState = state || this.state;
        const target = currentState.formState?.publishTarget;
        const hidden: string[] = [];

        if (target === PublishTarget.LocalContainer) {
            // Container deployment: hide server name field
            hidden.push(PublishFormFields.ServerName);
        } else if (
            target === PublishTarget.ExistingServer ||
            target === PublishTarget.NewAzureServer
        ) {
            // Existing server or new Azure server: hide container-specific fields
            hidden.push(...PublishFormContainerFields);
        }

        // Hide SQLCMD variables section if no variables exist
        const sqlCmdVars = currentState.formState?.sqlCmdVariables;
        const hasSqlCmdVariables = sqlCmdVars && Object.keys(sqlCmdVars).length > 0;
        if (!hasSqlCmdVariables) {
            hidden.push(PublishFormFields.SqlCmdVariables);
        }

        for (const component of Object.values(currentState.formComponents)) {
            component.hidden = hidden.includes(component.propertyName);
        }

        return Promise.resolve();
    }

    protected async validateForm(
        formTarget: IPublishForm,
        propertyName?: keyof IPublishForm,
        updateValidation?: boolean,
    ): Promise<(keyof IPublishForm)[]> {
        // Call parent validation logic which returns array of fields with errors
        const erroredInputs = await super.validateForm(formTarget, propertyName, updateValidation);

        // erroredInputs only contains fields validated with updateValidation=true (on blur)
        // So we also need to check for missing required values (which may not be validated yet on dialog open)
        const hasValidationErrors = updateValidation && erroredInputs.length > 0;
        const hasMissingRequiredValues = hasAnyMissingRequiredValues(
            this.state.formComponents,
            this.state.formState,
        );

        // Check SQLCMD variables validation using shared utility
        const sqlCmdVariablesValid = validateSqlCmdVariables(this.state.formState.sqlCmdVariables);

        // hasFormErrors state tracks to disable buttons if ANY errors exist
        this.state.hasFormErrors =
            hasValidationErrors || hasMissingRequiredValues || !sqlCmdVariablesValid;

        return erroredInputs;
    }
}
