/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import ConnectionManager from "../controllers/connectionManager";
import * as Utils from "../models/utils";
import { ProfilerSessionManager } from "./profilerSessionManager";
import { SessionType, SessionState, XelFileInfo } from "./profilerTypes";
import { ProfilerWebviewController } from "./profilerWebviewController";
import { SESSION_NAME_MAX_LENGTH } from "../sharedInterfaces/profiler";
import VscodeWrapper from "../controllers/vscodeWrapper";
import { getProfilerConfigService } from "./profilerConfigService";
import { ProfilerSessionTemplate } from "../models/contracts/profiler";
import { Logger } from "../models/logger";
import { Profiler as LocProfiler } from "../constants/locConstants";

/**
 * Controller for the profiler feature.
 * Handles command registration, connection management, and launching the profiler UI.
 */
export class ProfilerController {
    private _logger: Logger;
    private _webviewControllers: Map<string, ProfilerWebviewController> = new Map();
    private _xelWebviewControllers: Map<string, ProfilerWebviewController> = new Map();
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

    private registerCommands(): void {
        // Launch Profiler command
        this._context.subscriptions.push(
            vscode.commands.registerCommand("mssql.profiler.launch", async () => {
                try {
                    await this.launchProfiler();
                } catch (e) {
                    this._logger.error(`Command error: ${e}`);
                    vscode.window.showErrorMessage(LocProfiler.failedToLaunchProfiler(String(e)));
                }
            }),
        );

        // Open XEL File command
        this._context.subscriptions.push(
            vscode.commands.registerCommand("mssql.profiler.openXelFile", async () => {
                try {
                    await this.openXelFileCommand();
                } catch (e) {
                    this._logger.error(`Command error: ${e}`);
                    vscode.window.showErrorMessage(LocProfiler.failedToOpenXelFile(String(e)));
                }
            }),
        );

        this._logger.verbose("Profiler commands registered");
    }

    /**
     * Prompts the user to select a saved connection profile and connects to it.
     * Creates a dedicated profiler connection.
     * @returns The connection URI if successful, undefined if cancelled or failed
     */
    private async promptForNewConnection(): Promise<string | undefined> {
        try {
            // Get available connection profiles
            const connectionProfiles =
                await this._connectionManager.connectionStore.getPickListItems();

            if (connectionProfiles.length === 0) {
                vscode.window.showWarningMessage(LocProfiler.noSavedConnections);
                return undefined;
            }

            // Show quick pick for connection selection
            const connectionCreds = await this._connectionManager.connectionUI.promptForConnection(
                connectionProfiles,
                true, // ignoreFocusOut
            );

            if (!connectionCreds) {
                this._logger.verbose("User cancelled connection selection");
                return undefined;
            }

            // Generate a unique URI for this profiler connection
            const profilerUri = `profiler://${Utils.generateGuid()}`;
            this._logger.verbose(
                `Connecting to ${connectionCreds.server} with URI: ${profilerUri}`,
            );

            // Connect using the connection manager
            const connected = await this._connectionManager.connect(profilerUri, connectionCreds);

            if (connected) {
                this._logger.verbose(`Successfully connected to ${connectionCreds.server}`);
                return profilerUri;
            } else {
                this._logger.verbose("Connection failed");
                vscode.window.showErrorMessage(LocProfiler.failedToConnect);
                return undefined;
            }
        } catch (e) {
            this._logger.error(`Error connecting: ${e}`);
            vscode.window.showErrorMessage(LocProfiler.connectionError(String(e)));
            return undefined;
        }
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
            const session = this._sessionManager.createSession({
                id: sessionId,
                ownerUri: this._profilerUri,
                sessionName: sessionName,
                sessionType: SessionType.Live,
                templateName: "Standard",
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

        try {
            // Step 1: Show template selection quick pick
            const configService = getProfilerConfigService();
            const templates = configService.getTemplates();

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

            // Step 7: Auto-start the session
            await this.startSession(sessionName, webviewController);
        } catch (e) {
            this._logger.error(`Error creating session: ${e}`);
            webviewController.setCreatingSession(false);
            vscode.window.showErrorMessage(LocProfiler.failedToCreateSession(String(e)));
        }
    }

    /**
     * Launches the profiler UI with a connection to manage profiling sessions.
     * This is the main entry point for opening a profiler window.
     */
    public async launchProfiler(): Promise<void> {
        this._logger.verbose("Launching profiler...");

        try {
            // Prompt user to select a server and create a dedicated profiler connection
            this._logger.verbose("Prompting user to select a server for profiling...");
            const profilerUri = await this.promptForNewConnection();
            if (!profilerUri) {
                this._logger.verbose("User cancelled or connection failed");
                return;
            }
            this._logger.verbose(`Profiler connection created: ${profilerUri}`);
            this._profilerUri = profilerUri;

            // Fetch available XEvent sessions from the server
            this._logger.verbose("Fetching available XEvent sessions...");
            const xeventSessions = await this._sessionManager.getXEventSessions(profilerUri);
            this._logger.verbose(`Found ${xeventSessions.length} available XEvent sessions`);

            // Convert to session objects for the webview
            const availableSessions = xeventSessions.map((name) => ({
                id: name,
                name: name,
            }));

            // Create the webview to display events with the standard template
            // Don't create a ProfilerSession yet - wait for user to select and click Start
            const webviewController = new ProfilerWebviewController(
                this._context,
                this._vscodeWrapper,
                this._sessionManager,
                availableSessions,
                undefined, // No initial session name
                "Standard_OnPrem", // templateId
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
                        } else if (session.state === SessionState.Paused) {
                            this._logger.verbose(`Resuming profiler session ${session.id}...`);
                            await this._sessionManager.togglePauseProfilingSession(session.id);
                            webviewController.setSessionState(SessionState.Running);
                            this._logger.verbose("Session resumed");
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
                    } catch (e) {
                        this._logger.error(`Error stopping session: ${e}`);
                    }
                },
                onViewChange: (viewId: string) => {
                    this._logger.verbose(`View changed to: ${viewId}`);
                },
            });

            this._logger.verbose(
                "Profiler UI created. Select a session and click Start to begin profiling.",
            );
            vscode.window.showInformationMessage(LocProfiler.profilerReady);
        } catch (e) {
            this._logger.error(`Error launching profiler: ${e}`);
            vscode.window.showErrorMessage(LocProfiler.failedToLaunchProfiler(String(e)));
        }
    }

    /**
     * Opens a file picker dialog for the user to select an XEL file.
     * Launches the profiler UI in read-only mode for the selected file.
     */
    private async openXelFileCommand(): Promise<void> {
        this._logger.verbose("Opening XEL file picker...");

        const fileUri = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            filters: {
                [LocProfiler.xelFileFilter]: ["xel"],
            },
            title: LocProfiler.selectXelFile,
        });

        if (!fileUri || fileUri.length === 0) {
            this._logger.verbose("User cancelled XEL file selection");
            return;
        }

        const filePath = fileUri[0].fsPath;
        await this.openXelFile(filePath);
    }

    /**
     * Opens an XEL file in the profiler UI in read-only mode.
     * Can be called from the command or from the custom editor provider.
     * XEL file sessions do not require a database connection - they are purely file-based.
     * @param filePath - Full path to the XEL file
     */
    public async openXelFile(filePath: string): Promise<void> {
        this._logger.verbose(`Opening XEL file: ${filePath}`);

        // Validate file exists and is accessible
        const fileInfo = await this.validateXelFile(filePath);
        if (!fileInfo) {
            return;
        }

        // Check if we already have a webview for this file
        if (this._xelWebviewControllers.has(filePath)) {
            this._logger.verbose(`Webview already exists for ${filePath}, focusing it`);
            const existingController = this._xelWebviewControllers.get(filePath)!;
            existingController.revealToForeground();
            return;
        }

        // XEL file sessions do not require a database connection
        // The file is parsed locally and displayed in read-only mode
        this._logger.verbose("Opening XEL file in read-only disconnected mode...");

        try {
            // Create the webview controller in read-only disconnected mode
            const webviewController = new ProfilerWebviewController(
                this._context,
                this._vscodeWrapper,
                this._sessionManager,
                [], // No available sessions for file mode (disconnected)
                undefined, // No session name initially
                "Standard_OnPrem", // templateId
                true, // isReadOnly
                fileInfo, // XEL file info
            );

            // Track this webview controller
            this._xelWebviewControllers.set(filePath, webviewController);

            // Remove from tracking when disposed
            const originalDispose = webviewController.dispose.bind(webviewController);
            webviewController.dispose = () => {
                this._xelWebviewControllers.delete(filePath);
                // No connection to clean up for file-based sessions
                originalDispose();
            };

            // Show loading notification
            vscode.window.showInformationMessage(LocProfiler.loadingXelFile(fileInfo.fileName));

            // Set up event handlers for read-only mode (most are no-ops)
            this.setupXelWebviewHandlers(webviewController, fileInfo);

            // Load the XEL file events into the webview
            await this.loadXelFileEvents(webviewController, fileInfo);

            // Show success notification explaining read-only mode
            vscode.window.showInformationMessage(
                LocProfiler.xelFileReadOnlyDisconnectedNotification(fileInfo.fileName),
            );

            this._logger.verbose(
                `XEL file ${fileInfo.fileName} opened successfully in read-only mode`,
            );
        } catch (e) {
            this._logger.error(`Error opening XEL file: ${e}`);
            vscode.window.showErrorMessage(LocProfiler.failedToOpenXelFile(String(e)));
        }
    }

    /**
     * Validates that the XEL file exists and is accessible.
     * @param filePath - Path to the XEL file
     * @returns XelFileInfo if valid, undefined if invalid
     */
    private async validateXelFile(filePath: string): Promise<XelFileInfo | undefined> {
        try {
            const stats = await fs.promises.stat(filePath);

            if (!stats.isFile()) {
                this._logger.error(`Path is not a file: ${filePath}`);
                vscode.window.showErrorMessage(LocProfiler.invalidXelFile);
                return undefined;
            }

            const ext = path.extname(filePath).toLowerCase();
            if (ext !== ".xel") {
                this._logger.error(`File is not an XEL file: ${filePath}`);
                vscode.window.showErrorMessage(LocProfiler.invalidXelFile);
                return undefined;
            }

            return {
                filePath,
                fileName: path.basename(filePath),
                fileSize: stats.size,
            };
        } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") {
                this._logger.error(`XEL file not found: ${filePath}`);
                vscode.window.showErrorMessage(LocProfiler.xelFileNotFound);
            } else if ((e as NodeJS.ErrnoException).code === "EACCES") {
                this._logger.error(`Access denied to XEL file: ${filePath}`);
                vscode.window.showErrorMessage(LocProfiler.xelFileAccessDenied);
            } else {
                this._logger.error(`Error accessing XEL file: ${e}`);
                vscode.window.showErrorMessage(LocProfiler.failedToOpenXelFile(String(e)));
            }
            return undefined;
        }
    }

    /**
     * Sets up event handlers for an XEL file webview (read-only disconnected mode).
     * Most handlers are no-ops since we have no connection.
     */
    private setupXelWebviewHandlers(
        webviewController: ProfilerWebviewController,
        _fileInfo: XelFileInfo,
    ): void {
        webviewController.setEventHandlers({
            // New Session - disabled in read-only disconnected mode
            onCreateSession: async () => {
                // No-op for read-only disconnected sessions
                this._logger.verbose(
                    "Create session ignored for read-only disconnected XEL file session",
                );
            },
            // Start Session - disabled in read-only disconnected mode
            onStartSession: async () => {
                // No-op for read-only disconnected sessions
                this._logger.verbose(
                    "Start session ignored for read-only disconnected XEL file session",
                );
            },
            // Pause/Resume - disabled for read-only file sessions
            onPauseResume: async () => {
                // No-op for read-only sessions
                this._logger.verbose("Pause/Resume ignored for read-only XEL file session");
            },
            // Stop - disabled for read-only file sessions
            onStop: async () => {
                // No-op for read-only sessions
                this._logger.verbose("Stop ignored for read-only XEL file session");
            },
            onViewChange: (viewId: string) => {
                this._logger.verbose(`View changed to: ${viewId}`);
            },
        });
    }

    /**
     * Loads XEL file events into the webview by creating a file-based profiler session.
     * Uses the backend to parse the XEL file and stream events to the UI.
     */
    private async loadXelFileEvents(
        webviewController: ProfilerWebviewController,
        fileInfo: XelFileInfo,
    ): Promise<void> {
        this._logger.verbose(`Loading XEL file events for: ${fileInfo.filePath}`);

        // Set the session name to the file name
        webviewController.setSessionName(fileInfo.fileName);

        // Generate a unique URI for this file-based session (not a real connection)
        const fileSessionUri = `profiler://xelfile/${Utils.generateGuid()}`;
        this._logger.verbose(`Created file session URI: ${fileSessionUri}`);

        // Create a ProfilerSession for the file
        const sessionId = Utils.generateGuid();
        const session = this._sessionManager.createSession({
            id: sessionId,
            ownerUri: fileSessionUri,
            sessionName: fileInfo.filePath, // Full path to XEL file for the backend
            sessionType: SessionType.File,
            templateName: "XEL_File",
            readOnly: true,
        });
        this._logger.verbose(`Created ProfilerSession: id=${sessionId}, type=File`);

        // Set up the webview controller with the session reference
        webviewController.setCurrentSession(session);

        // Set up event handlers on the session
        session.onEventsReceived((events) => {
            this._logger.verbose(
                `Events received: ${events.length} events for XEL file session ${sessionId}`,
            );
            webviewController.notifyNewEvents(events.length);
        });

        session.onEventsRemoved((events) => {
            const sequenceNumbers = events.map((e) => e.eventNumber).join(", ");
            this._logger.verbose(
                `Events removed from ring buffer: ${events.length} events (sequence #s: ${sequenceNumbers}) for XEL file session ${sessionId}`,
            );
            webviewController.notifyRowsRemoved(events);
        });

        session.onSessionStopped((errorMessage) => {
            this._logger.verbose(`XEL file session ${sessionId} stopped notification received`);
            if (errorMessage) {
                this._logger.error(`XEL file session stopped with error: ${errorMessage}`);
            }
            // For file sessions, "Stopped" indicates file loading is complete
            webviewController.setSessionState(SessionState.Stopped);
        });

        try {
            // Start profiling - this tells the backend to read the XEL file
            // For file sessions, this loads all events from the file
            await this._sessionManager.startProfilingSession(sessionId);

            // File-based sessions go to "Stopped" state after loading (not "Running")
            // since there's no live data to stream
            webviewController.setSessionState(SessionState.Stopped);

            this._logger.verbose(
                `XEL file ${fileInfo.fileName} loaded successfully in read-only mode`,
            );
        } catch (e) {
            this._logger.error(`Failed to load XEL file: ${e}`);
            webviewController.setSessionState(SessionState.Stopped);
            throw e;
        }
    }

    /**
     * Gets the XEL webview controller for a given file path.
     * Used by the custom editor provider.
     */
    public getXelWebviewController(filePath: string): ProfilerWebviewController | undefined {
        return this._xelWebviewControllers.get(filePath);
    }

    public async dispose(): Promise<void> {
        // Dispose all XEL webview controllers
        for (const controller of this._xelWebviewControllers.values()) {
            controller.dispose();
        }
        this._xelWebviewControllers.clear();

        await this._sessionManager.dispose();
    }
}
