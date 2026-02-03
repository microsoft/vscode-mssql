/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import ConnectionManager from "../controllers/connectionManager";
import * as Utils from "../models/utils";
import { ProfilerSessionManager } from "./profilerSessionManager";
import {
    SessionType,
    SessionState,
    TEMPLATE_ID_STANDARD_ONPREM,
    EngineType,
} from "./profilerTypes";
import { ProfilerWebviewController } from "./profilerWebviewController";
import { SESSION_NAME_MAX_LENGTH } from "../sharedInterfaces/profiler";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getProfilerConfigService } from "./profilerConfigService";
import { ProfilerSessionTemplate } from "../models/contracts/profiler";
import { Logger } from "../models/logger";
import { Profiler as LocProfiler } from "../constants/locConstants";
import * as Constants from "../constants/constants";
import { IConnectionProfile } from "../models/interfaces";
import { ProfilerTelemetry } from "./profilerTelemetry";

/**
 * Controller for the profiler feature.
 * Handles command registration, connection management, and launching the profiler UI.
 */
export class ProfilerController {
    private _logger: Logger;
    private _webviewControllers: Map<string, ProfilerWebviewController> = new Map();
    private _profilerUri: string | undefined;

    constructor(
        private _context: vscode.ExtensionContext,
        private _connectionManager: ConnectionManager,
        private _vscodeWrapper: VscodeWrapper,
        private _sessionManager: ProfilerSessionManager,
    ) {
        this._logger = Logger.create(this._vscodeWrapper.outputChannel, "Profiler");
        this.registerCommands();
    }

    /**
     * Starts a profiling session for the given session name.
     * @param sessionName - The name of the XEvent session to start
     * @param webviewController - The specific webview controller for this session
     */
    private async startSession(
        sessionName: string,
        webviewController: ProfilerWebviewController,
    ): Promise<void> {
        this._logger.verbose(`Starting profiler session: ${sessionName}`);
        try {
            if (!this._profilerUri) {
                this._logger.verbose("No profiler connection available");
                vscode.window.showErrorMessage(LocProfiler.noConnectionAvailable);
                return;
            }

            // Clear existing session and captured events from previous sessions
            webviewController.setCurrentSession(undefined); // Clear old session first
            webviewController.clearRows();
            this._logger.verbose("Cleared existing events from grid");

            // Create a ProfilerSession for the selected session
            const sessionId = Utils.generateGuid();
            const bufferCapacity = vscode.workspace
                .getConfiguration(Constants.extensionConfigSectionName)
                .get<number>(Constants.configProfilerEventBufferSize);
            const session = this._sessionManager.createSession({
                id: sessionId,
                ownerUri: this._profilerUri,
                sessionName: sessionName,
                sessionType: SessionType.Live,
                templateName: "Standard",
                bufferCapacity: bufferCapacity,
            });
            this._logger.verbose(
                `Created ProfilerSession: id=${sessionId}, ownerUri=${this._profilerUri}`,
            );

            // Set up the webview controller with the session reference for pull model
            webviewController.setCurrentSession(session);

            // Set up event handlers on the session
            session.onEventsReceived((events) => {
                this._logger.verbose(
                    `Events received: ${events.length} events for session ${sessionId}`,
                );
                webviewController.notifyNewEvents(events.length);
            });

            session.onEventsRemoved((events) => {
                const sequenceNumbers = events.map((e) => e.eventNumber).join(", ");
                this._logger.verbose(
                    `Events removed from ring buffer: ${events.length} events (sequence #s: ${sequenceNumbers}) for session ${sessionId}`,
                );
                webviewController.notifyRowsRemoved(events);
            });

            session.onSessionStopped((errorMessage) => {
                this._logger.verbose(`Session ${sessionId} stopped notification received`);
                if (errorMessage) {
                    this._logger.error(`Session stopped with error: ${errorMessage}`);
                }
                webviewController.setSessionState(SessionState.Stopped);
            });

            // Start profiling on the session
            await this._sessionManager.startProfilingSession(sessionId);
            // Session is now running - update the webview state
            webviewController.setSessionState(SessionState.Running);
            webviewController.setSessionName(sessionName);
            this._logger.verbose("Profiling session started");

            // Send telemetry for session started
            ProfilerTelemetry.sendSessionStarted(sessionName, sessionId);
        } catch (e) {
            this._logger.error(`Error starting profiler session: ${e}`);
            vscode.window.showErrorMessage(LocProfiler.failedToStartProfiler(String(e)));
        }
    }

    /**
     * Handles the create session flow: shows quick picks for template and session name,
     * creates the session on the server, and starts profiling.
     * @param webviewController - The specific webview controller for this session
     */
    private async handleCreateSession(webviewController: ProfilerWebviewController): Promise<void> {
        if (!this._profilerUri) {
            this._logger.verbose("No profiler connection available");
            vscode.window.showErrorMessage(LocProfiler.noConnectionAvailable);
            return;
        }

        // Check if connected to an Azure SQL Database system database
        // Azure system databases (e.g., master) don't support creating Extended Events sessions
        if (this._engineType === EngineType.AzureSQLDB) {
            const connectionInfo = this._connectionManager.getConnectionInfo(this._profilerUri);
            const databaseName = connectionInfo?.credentials?.database?.toLowerCase();
            const azureSystemDatabases = ["master", "msdb", "tempdb", "model"];
            if (databaseName && azureSystemDatabases.includes(databaseName)) {
                this._logger.verbose(
                    `Cannot create profiler session on Azure system database: ${databaseName}`,
                );
                vscode.window.showErrorMessage(LocProfiler.cannotProfileAzureSystemDatabase);
                return;
            }
        }

        try {
            // Step 1: Show template selection quick pick
            // Filter templates by the detected engine type
            const configService = getProfilerConfigService();
            const templates = configService.getTemplatesForEngine(this._engineType);
            this._logger.verbose(
                `Found ${templates.length} templates for engine type: ${this._engineType}`,
            );

            if (templates.length === 0) {
                vscode.window.showWarningMessage(LocProfiler.noTemplatesAvailable);
                return;
            }

            const templateItems = templates.map((t) => ({
                label: t.name,
                description: t.description,
                detail: LocProfiler.engineLabel(t.engineType),
                template: t,
            }));

            const selectedTemplate = await vscode.window.showQuickPick(templateItems, {
                placeHolder: LocProfiler.selectTemplate,
                ignoreFocusOut: true,
                title: LocProfiler.newSessionSelectTemplate,
            });

            if (!selectedTemplate) {
                this._logger.verbose("User cancelled template selection");
                return;
            }

            this._logger.verbose(`Selected template: ${selectedTemplate.template.name}`);

            // Step 2: Show session name input
            const sessionName = await vscode.window.showInputBox({
                prompt: LocProfiler.enterSessionName,
                placeHolder: LocProfiler.sessionNamePlaceholder,
                title: LocProfiler.newSessionEnterName,
                ignoreFocusOut: true,
                validateInput: (value) => {
                    if (!value || value.trim().length === 0) {
                        return LocProfiler.sessionNameEmpty;
                    }
                    if (value.length > SESSION_NAME_MAX_LENGTH) {
                        return LocProfiler.sessionNameTooLong(SESSION_NAME_MAX_LENGTH);
                    }
                    // Check for invalid characters (basic validation)
                    if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
                        return LocProfiler.sessionNameInvalidChars;
                    }
                    return undefined;
                },
            });

            if (!sessionName) {
                this._logger.verbose("User cancelled session name input");
                return;
            }

            this._logger.verbose(`Session name: ${sessionName}`);

            // Step 3: Show spinner (set creating state)
            webviewController.setCreatingSession(true);

            // Step 4: Create the session on the server
            const template: ProfilerSessionTemplate = {
                name: selectedTemplate.template.name,
                defaultView: selectedTemplate.template.defaultView,
                createStatement: selectedTemplate.template.createStatement,
            };

            this._logger.verbose(
                `Creating XEvent session: ${sessionName} with template: ${template.name}`,
            );

            // Register handler for session created notification
            const sessionCreatedPromise = new Promise<void>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    disposable.dispose();
                    reject(new Error(LocProfiler.sessionCreationTimedOut));
                }, 30000); // 30 second timeout

                const disposable = this._sessionManager.onSessionCreated(
                    this._profilerUri!,
                    (params) => {
                        clearTimeout(timeout);
                        disposable.dispose();
                        this._logger.verbose(
                            `Session created notification received: ${params.sessionName}`,
                        );
                        resolve();
                    },
                );
            });

            // Send create session request
            await this._sessionManager.createXEventSession(
                this._profilerUri,
                sessionName,
                template,
            );

            // Wait for session created notification
            await sessionCreatedPromise;

            // Step 5: Refresh available sessions
            const xeventSessions = await this._sessionManager.getXEventSessions(this._profilerUri);
            const availableSessions = xeventSessions.map((name) => ({
                id: name,
                name: name,
            }));

            webviewController.updateAvailableSessions(availableSessions);
            webviewController.setSelectedSession(sessionName);
            webviewController.setCreatingSession(false);

            // Step 6: Show success notification
            vscode.window.showInformationMessage(
                LocProfiler.sessionCreatedSuccessfully(sessionName),
            );
            this._logger.verbose(`Session '${sessionName}' created successfully`);

            // Send telemetry for session created
            ProfilerTelemetry.sendSessionCreated(sessionName, selectedTemplate.template.name);

            // Step 7: Auto-start the session
            await this.startSession(sessionName, webviewController);
        } catch (e) {
            this._logger.error(`Error creating session: ${e}`);
            webviewController.setCreatingSession(false);
            vscode.window.showErrorMessage(LocProfiler.failedToCreateSession(String(e)));
        }
    }

    /**
     * Launches the profiler UI with a provided connection profile (from Object Explorer).
     * This skips the connection prompt and uses the provided connection directly.
     * For Azure SQL Database connections to system databases, prompts user to select a user database.
     * @param connectionProfile - The connection profile to use for profiling
     */
    public async launchProfilerWithConnection(
        connectionProfile: IConnectionProfile,
    ): Promise<void> {
        this._logger.verbose(
            `Launching profiler with connection to ${connectionProfile.server}...`,
        );

        try {
            // Generate a unique URI for this profiler connection
            let profilerUri = `profiler://${Utils.generateGuid()}`;
            this._logger.verbose(
                `Connecting to ${connectionProfile.server} with URI: ${profilerUri}`,
            );

            // Connect using the connection manager with the provided profile
            let connected = await this._connectionManager.connect(profilerUri, connectionProfile);

            if (!connected) {
                this._logger.verbose("Connection failed");
                vscode.window.showErrorMessage(LocProfiler.failedToConnect);
                return;
            }

            this._logger.verbose(`Successfully connected to ${connectionProfile.server}`);

            // For Azure SQL Database, check if connected to a system database and prompt for database selection
            if (this._engineType === EngineType.AzureSQLDB) {
                const connectionInfo = this._connectionManager.getConnectionInfo(profilerUri);
                const currentDatabase = connectionInfo?.credentials?.database?.toLowerCase() || "";
                const azureSystemDatabases = ["master", "msdb", "tempdb", "model"];

                if (!currentDatabase || azureSystemDatabases.includes(currentDatabase)) {
                    this._logger.verbose(
                        `Connected to Azure system database '${currentDatabase}', prompting for database selection...`,
                    );

                    // Prompt user to select a user database
                    const selectedDatabase = await this.promptForAzureDatabase(profilerUri);

                    if (!selectedDatabase) {
                        // User cancelled - disconnect and return
                        this._logger.verbose("User cancelled database selection");
                        await this._connectionManager.disconnect(profilerUri);
                        return;
                    }

                    // Disconnect current connection and reconnect with selected database
                    await this._connectionManager.disconnect(profilerUri);

                    // Create new connection profile with selected database
                    const updatedProfile = { ...connectionProfile, database: selectedDatabase };
                    profilerUri = `profiler://${Utils.generateGuid()}`;

                    this._logger.verbose(
                        `Reconnecting to database '${selectedDatabase}' with URI: ${profilerUri}`,
                    );

                    connected = await this._connectionManager.connect(profilerUri, updatedProfile);

                    if (!connected) {
                        this._logger.verbose("Reconnection failed");
                        vscode.window.showErrorMessage(LocProfiler.failedToConnect);
                        return;
                    }

                    this._logger.verbose(
                        `Successfully reconnected to database '${selectedDatabase}'`,
                    );
                }
            }

            // Use the common setup method
            await this.setupProfilerUI(profilerUri);
        } catch (e) {
            this._logger.error(`Error launching profiler: ${e}`);
            vscode.window.showErrorMessage(LocProfiler.failedToLaunchProfiler(String(e)));
        }
    }

    /**
     * Prompts the user to select a database for profiling on Azure SQL Database.
     * Filters out system databases.
     * @param profilerUri - The URI of the current profiler connection
     * @returns The selected database name, or undefined if cancelled
     */
    private async promptForAzureDatabase(profilerUri: string): Promise<string | undefined> {
        const azureSystemDatabases = ["master", "msdb", "tempdb", "model"];

        try {
            // Fetch list of databases
            this._logger.verbose("Fetching available databases...");
            const databases = await this._connectionManager.listDatabases(profilerUri);

            // Filter out system databases
            const userDatabases = databases.filter(
                (db) => !azureSystemDatabases.includes(db.toLowerCase()),
            );

            if (userDatabases.length === 0) {
                vscode.window.showWarningMessage(LocProfiler.noUserDatabasesAvailable);
                return undefined;
            }

            // Show quick pick for database selection
            const databaseItems = userDatabases.map((db) => ({
                label: db,
                description: "",
            }));

            const selected = await vscode.window.showQuickPick(databaseItems, {
                placeHolder: LocProfiler.selectDatabaseForProfiling,
                title: LocProfiler.selectDatabaseTitle,
                ignoreFocusOut: true,
            });

            return selected?.label;
        } catch (e) {
            this._logger.error(`Error fetching databases: ${e}`);
            throw e;
        }
    }

    /**
     * Common setup for the profiler UI after a connection has been established.
     * Creates the webview, sets up event handlers, and prepares for profiling.
     * @param profilerUri - The URI of the established profiler connection
     */
    private async setupProfilerUI(profilerUri: string): Promise<void> {
        this._profilerUri = profilerUri;

        // Fetch available XEvent sessions from the server
        // If this fails (e.g., Azure system databases), still open the UI so users can create sessions
        this._logger.verbose("Fetching available XEvent sessions...");
        let xeventSessions: string[] = [];
        try {
            xeventSessions = await this._sessionManager.getXEventSessions(profilerUri);
            this._logger.verbose(`Found ${xeventSessions.length} available XEvent sessions`);
        } catch (e) {
            this._logger.warn(
                `Could not fetch XEvent sessions (this may be expected for Azure system databases): ${e}`,
            );
            // Continue with empty session list - user can still create a new session
        }

        // Convert to session objects for the webview
        const availableSessions = xeventSessions.map((name) => ({
            id: name,
            name: name,
        }));

        // Select the appropriate default template based on engine type
        const defaultTemplateId =
            this._engineType === EngineType.AzureSQLDB ? "Standard_Azure" : "Standard_OnPrem";
        this._logger.verbose(`Using default template: ${defaultTemplateId}`);

        // Create the webview to display events with the standard template
        // Don't create a ProfilerSession yet - wait for user to select and click Start
        const webviewController = new ProfilerWebviewController(
            this._context,
            this._vscodeWrapper,
            this._sessionManager,
            availableSessions,
            undefined, // No initial session name
            TEMPLATE_ID_STANDARD_ONPREM, // templateId based on engine type
        );

        // Track this webview controller along with its profiler URI for cleanup
        const webviewId = Utils.generateGuid();
        const webviewProfilerUri = profilerUri; // Capture for cleanup
        this._webviewControllers.set(webviewId, webviewController);

        // Remove from tracking and clean up connection when disposed
        const originalDispose = webviewController.dispose.bind(webviewController);
        webviewController.dispose = () => {
            this._webviewControllers.delete(webviewId);

            // Disconnect the profiler connection to avoid lingering connections
            this._logger.verbose(`Cleaning up profiler connection: ${webviewProfilerUri}`);
            this._connectionManager.disconnect(webviewProfilerUri).catch((err) => {
                this._logger.error(`Error disconnecting profiler connection: ${err}`);
            });

            originalDispose();
        };

        // Set up webview event handlers for toolbar actions
        // Capture webviewController in the closure so each webview has its own handlers
        webviewController.setEventHandlers({
            onCreateSession: async () => {
                await this.handleCreateSession(webviewController);
            },
            onStartSession: async (selectedSessionId: string) => {
                await this.startSession(selectedSessionId, webviewController);
            },
            onPauseResume: async () => {
                // Get the session for THIS webview directly from the controller
                const session = webviewController.currentSession;

                if (!session) {
                    this._logger.verbose("No active session to pause/resume for this webview");
                    return;
                }
                try {
                    this._logger.verbose(
                        `Current session state: ${session.state}, session.id: ${session.id}`,
                    );
                    if (session.state === SessionState.Running) {
                        this._logger.verbose(`Pausing profiler session ${session.id}...`);
                        await this._sessionManager.pauseProfilingSession(session.id);
                        webviewController.setSessionState(SessionState.Paused);
                        this._logger.verbose("Session paused");

                        // Send telemetry for session paused
                        const eventCount = session.events?.size ?? 0;
                        ProfilerTelemetry.sendSessionPaused(session.id, eventCount);
                    } else if (session.state === SessionState.Paused) {
                        this._logger.verbose(`Resuming profiler session ${session.id}...`);
                        await this._sessionManager.togglePauseProfilingSession(session.id);
                        webviewController.setSessionState(SessionState.Running);
                        this._logger.verbose("Session resumed");

                        // Send telemetry for session resumed
                        ProfilerTelemetry.sendSessionResumed(session.id);
                    } else {
                        this._logger.verbose(
                            `Session in unexpected state: ${session.state}, cannot pause/resume`,
                        );
                    }
                } catch (e) {
                    this._logger.error(`Error pausing/resuming session: ${e}`);
                }
            },
            onStop: async () => {
                // Get the session for THIS webview directly from the controller
                const session = webviewController.currentSession;

                if (!session) {
                    this._logger.verbose("No active session to stop for this webview");
                    return;
                }
                try {
                    this._logger.verbose(`Stopping profiler session ${session.id}...`);
                    await this._sessionManager.stopProfilingSession(session.id);
                    webviewController.setSessionState(SessionState.Stopped);
                    this._logger.verbose("Session stopped");

                    // Send telemetry for session stopped
                    const eventCount = session.events?.size ?? 0;
                    ProfilerTelemetry.sendSessionStopped(session.id, eventCount);
                } catch (e) {
                    this._logger.error(`Error stopping session: ${e}`);
                }
            },
            onViewChange: (viewId: string) => {
                this._logger.verbose(`View changed to: ${viewId}`);
            },
            onExportToCsv: async (
                csvContent: string,
                suggestedFileName: string,
                trigger: "manual" | "closePrompt",
            ) => {
                await this.handleExportToCsv(
                    webviewController,
                    csvContent,
                    suggestedFileName,
                    trigger,
                );
            },
        });

        this._logger.verbose(
            "Profiler UI created. Select a session and click Start to begin profiling.",
        );
        vscode.window.showInformationMessage(LocProfiler.profilerReady);
    }

    /**
     * Handles exporting profiler events to a CSV file
     */
    private async handleExportToCsv(
        webviewController: ProfilerWebviewController,
        csvContent: string,
        suggestedFileName: string,
        trigger: "manual" | "closePrompt",
    ): Promise<void> {
        try {
            // Get a default folder - use user's home directory or workspace folder
            const defaultFolder =
                vscode.workspace.workspaceFolders?.[0]?.uri ??
                vscode.Uri.file(require("os").homedir());

            // Show save dialog
            const saveUri = await vscode.window.showSaveDialog({
                defaultUri: vscode.Uri.joinPath(defaultFolder, `${suggestedFileName}.csv`),
                filters: {
                    CSV: ["csv"],
                },
                title: LocProfiler.exportToCsv,
            });

            if (!saveUri) {
                // User cancelled
                this._logger.verbose("Export to CSV cancelled by user");
                return;
            }

            // Write the CSV content to the file
            await vscode.workspace.fs.writeFile(saveUri, new TextEncoder().encode(csvContent));

            // Count the number of rows exported (count newlines minus header)
            const rowCount = csvContent.split("\n").length - 1;

            // Send telemetry for successful export
            ProfilerTelemetry.sendExportCsv(rowCount, trigger);

            // Mark export as successful in state
            webviewController.setExportComplete();

            // Show success message with Open File button
            const openFile = await vscode.window.showInformationMessage(
                LocProfiler.exportSuccess(saveUri.fsPath),
                LocProfiler.openFile,
            );

            if (openFile === LocProfiler.openFile) {
                // Open the exported file in VS Code
                const doc = await vscode.workspace.openTextDocument(saveUri);
                await vscode.window.showTextDocument(doc);
            }

            this._logger.verbose(`Profiler events exported to ${saveUri.fsPath}`);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            void vscode.window.showErrorMessage(LocProfiler.exportFailed(errorMessage));
            this._logger.error(`Failed to export profiler events: ${errorMessage}`);
        }
    }
}
