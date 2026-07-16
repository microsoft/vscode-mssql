/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { ActivityStatus, TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    ColorThemeChangeNotification,
    ExecuteCommandParams,
    ExecuteCommandRequest,
    GetEOLRequest,
    GetKeyBindingsConfigRequest,
    GetLocalizationRequest,
    GetPlatformRequest,
    GetStateRequest,
    GetThemeRequest,
    KeyBindingsChangeNotification,
    LoadStatsNotification,
    LogNotification,
    ReducerRequest,
    SendActionEventNotification,
    SendErrorEventNotification,
    StateChangeNotification,
    WebviewRpcMessage,
    WebviewTelemetryActionEvent,
    WebviewTelemetryErrorEvent,
} from "../sharedInterfaces/webview";
import { sendActionEvent, sendErrorEvent, startActivity } from "../telemetry/telemetry";

import * as fs from "fs";
import * as path from "path";
import { getEditorEOL, getErrorMessage, getNonce } from "../utils/utils";
import { LoggerMethod, ILogger, LogEvent } from "../sharedInterfaces/logger";
import { logger } from "../models/logger";
import {
    AbstractMessageReader,
    AbstractMessageWriter,
    CancellationToken,
    createMessageConnection,
    DataCallback,
    Disposable,
    Emitter,
    Message,
    MessageConnection,
    MessageReader,
    MessageWriter,
    NotificationType,
    type RequestParam,
    RequestHandler,
    RequestType,
} from "vscode-jsonrpc/node";
import { Deferred } from "../protocol";
import * as Constants from "../constants/constants";
import * as LocalizedConstants from "../constants/locConstants";
import { getLocalizationFileContentsCached } from "./localizationCache";
import { Perf } from "../perf/perfTelemetry";
import { diag } from "../diagnostics/diagnosticsCore";
import { PerfEnableNotification, PerfWebviewMarkNotification } from "../sharedInterfaces/perf";

export const WEBVIEW_INIT_TIMEOUT_MS = 5_000;

/**
 * Cache-buster for UNHASHED webview entry assets (see _getHtmlTemplate).
 * One stamp per extension-host session: new host = fresh fetch, same host =
 * normal caching.
 */
const WEBVIEW_ASSET_STAMP = Date.now().toString(36);

class WebviewControllerMessageReader extends AbstractMessageReader implements MessageReader {
    private _onData: Emitter<Message>;
    private _disposables: vscode.Disposable[] = [];
    private _webview: vscode.Webview;
    constructor() {
        super();
        this._onData = new Emitter<Message>();
    }

    updateWebview(webview: vscode.Webview) {
        // Clean up existing disposables
        this._disposables.forEach((d) => d.dispose());
        this._disposables = [];

        this._webview = webview;

        if (webview) {
            const disposable = this._webview.onDidReceiveMessage((event) => {
                this._onData.fire(event);
            });
            this._disposables.push(disposable);
        }
    }

    listen(callback: DataCallback): Disposable {
        return this._onData.event(callback);
    }
}

class WebviewControllerMessageWriter extends AbstractMessageWriter implements MessageWriter {
    private _webview: vscode.Webview;
    constructor(private logger: ILogger) {
        super();
    }
    updateWebview(webview: vscode.Webview) {
        this._webview = webview;
    }
    write(msg: Message): Promise<void> {
        if (this._webview) {
            this._webview.postMessage(msg);
        } else {
            this.logger.warn("Attempted to write message but webview is not set");
        }
        return Promise.resolve();
    }
    end(): void {}
}

/**
 * WebviewBaseController is a class that manages a vscode.Webview and provides
 * a way to communicate with it. It provides a way to register request handlers and reducers
 * that can be called from the webview. It also provides a way to post notifications to the webview.
 * @template State The type of the state object that the webview will use
 * @template Reducers The type of the reducers that the webview will use
 */
export abstract class WebviewBaseController<State, Reducers> implements vscode.Disposable {
    private _disposables: vscode.Disposable[] = [];
    private _isDisposed: boolean = false;
    private _onDisposed: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    public readonly onDisposed: vscode.Event<void> = this._onDisposed.event;

    /**
     * A one-time promise that resolves when the webview is ready to receive messages.
     */
    private _webviewReady: Deferred<void> = new Deferred<void>();
    private _isWebviewReady: boolean = false;
    private _webviewReadyTimeoutHandle: ReturnType<typeof setTimeout> | undefined;

    private _state: State;
    private _isFirstLoad: boolean = true;
    protected _loadStartTime: number = Date.now();
    private _endLoadActivity = startActivity(
        TelemetryViews.WebviewController,
        TelemetryActions.Load,
    );

    public connection: MessageConnection;
    private _connectionReader: WebviewControllerMessageReader;
    private _connectionWriter: WebviewControllerMessageWriter;
    private _reducerHandlers = new Map<
        keyof Reducers,
        (state: State, payload: Reducers[keyof Reducers]) => ReducerResponse<State>
    >();

    protected logger: ILogger;

    /**
     * Creates a new WebviewPanelController
     * @param _context The context of the extension
     * @param _sourceFile The source file that the webview will use
     * @param _initialData The initial state object that the webview will use
     */
    constructor(
        protected _context: vscode.ExtensionContext,
        private _sourceFile: string,
        private _initialData: State,
        viewId?: string,
    ) {
        this.logger = logger.withPrefix(viewId ?? "WebviewBaseController");

        this._connectionReader = new WebviewControllerMessageReader();
        this._connectionWriter = new WebviewControllerMessageWriter(this.logger);
        this.connection = createMessageConnection(this._connectionReader, this._connectionWriter);
        this.connection.listen();

        // Add connection to disposables for cleanup
        this._disposables.push({
            dispose: () => {
                this.connection.dispose();
                this._connectionReader.dispose();
                this._connectionWriter.dispose();
            },
        });

        // Webview mark bridge: forward webview marks (render timings, window
        // fetches) to the diagnostics core. Active in PERF_MODE (harness) and
        // whenever a diagnostics sink is live (Debug Console open or Session
        // Diag capture on); otherwise fully inert. The enable notification is
        // re-sent on a short schedule because "webview ready" can precede the
        // app's handler registration; the webview queues marks (with original
        // timestamps) until one of the sends lands.
        this.connection.onNotification(PerfWebviewMarkNotification.type, (mark) => {
            Perf.webviewMark(mark, this._sourceFile);
        });
        // Unconditional schedule (not gated on whenWebviewReady, which can
        // time out on cold first loads): sends to a not-yet-ready webview
        // are dropped harmlessly, and the webview queues marks with their
        // original timestamps until one enable lands. Late sends also cover
        // "console opened after the webview loaded".
        const sendEnableIfWanted = () => {
            if (this._isDisposed) {
                return;
            }
            if (!Perf.enabled && !diag.anySinkActive) {
                return;
            }
            try {
                void this.connection.sendNotification(PerfEnableNotification.type, undefined);
            } catch {
                // disposed between check and send; ignore
            }
        };
        for (const delayMs of [500, 2000, 5000, 15000, 30000]) {
            const timer = setTimeout(sendEnableIfWanted, delayMs);
            this._disposables.push({ dispose: () => clearTimeout(timer) });
        }
        // Keep late-opened consoles covered: re-check periodically (cheap).
        const enablePoll = setInterval(sendEnableIfWanted, 20000);
        enablePoll.unref?.();
        this._disposables.push({ dispose: () => clearInterval(enablePoll) });
    }

    /**
     * Updates the webview used by JSON RPC connection.
     * This method should be called whenever the webview is recreated or updated.
     * @param webview
     */
    protected updateConnectionWebview(webview: vscode.Webview) {
        if (webview) {
            this._connectionReader.updateWebview(webview);
            this._connectionWriter.updateWebview(webview);
        }
    }

    protected initializeBase() {
        if (!this.state) {
            this.state = this._initialData;
        }
        this._registerDefaultRequestHandlers();
        this.setupTheming();
        this.setupKeyBindings();
    }

    protected registerDisposable(disposable: vscode.Disposable) {
        this._disposables.push(disposable);
    }

    /**
     * Per-surface Content-Security-Policy (VEC-5 P0; opt-in per controller so
     * existing webviews are untouched until each surface is proven safe).
     * When enabled, the policy denies EVERYTHING by default and allows only
     * what a local-content webview needs: extension-served scripts (nonce),
     * styles, images, and fonts. `connect-src 'none'` = the surface can make
     * ZERO network requests — the Vector Workbench's offline guarantee is
     * enforced by the platform, not by code review.
     */
    protected cspOptions(): { enabled: boolean; allowWorker?: boolean } {
        return { enabled: false };
    }

    protected _getHtmlTemplate() {
        const nonce = getNonce();
        // VS Code's webview service worker caches resources by URL, and the
        // ENTRY bundle/stylesheet names are unhashed (queryStudio.js, ….css):
        // after a rebuild a new webview can silently render a STALE cached
        // bundle (chunks are content-hashed; only entries are at risk). The
        // per-host-session stamp busts that cache on every extension-host
        // start while still caching within a session.
        const assetStamp = `?v=${WEBVIEW_ASSET_STAMP}`;

        const baseUrl = this._getWebview().asWebviewUri(
            vscode.Uri.joinPath(this._context.extensionUri, "dist", "views"),
        );
        const baseUrlString = baseUrl.toString() + "/";
        const csp = this.cspOptions();
        const cspSource = this._getWebview().cspSource;
        // Monaco spawns its editor worker from a blob: URL — surfaces that
        // opt into allowWorker get `worker-src blob:` alongside the
        // extension origin; connect-src stays 'none' regardless.
        const cspMeta = csp.enabled
            ? `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' ${cspSource} blob:; style-src ${cspSource} 'unsafe-inline'; img-src ${cspSource} data:; font-src ${cspSource}; connect-src ${csp.allowWorker ? cspSource : "'none'"};${csp.allowWorker ? ` worker-src ${cspSource} blob:;` : ""}">`
            : "";
        // BOOT-2: modulepreload the entry's static-closure chunks (manifest
        // emitted at bundle time) — the browser otherwise discovers ESM
        // static imports only AFTER parsing each module (a fetch waterfall).
        const preloads = preloadChunksFor(this._context.extensionPath, this._sourceFile)
            .map((chunk) => `<link rel="modulepreload" nonce="${nonce}" href="${chunk}">`)
            .join("\n\t\t\t\t\t");

        return `
		<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					${cspMeta}
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>mssqlwebview</title>
					<base href="${baseUrlString}"> <!-- Required for loading relative resources in the webview -->
					${preloads}
				<style>
					html, body {
						margin: 0;
						padding: 0px;
  						width: 100%;
  						height: 100%;
					}
				</style>
				</head>
				<body>
					<link rel="stylesheet" href="${this._sourceFile}.css${assetStamp}">
					<div id="root"></div>
				  	<script type="module" nonce="${nonce}" src="${this._sourceFile}.js${assetStamp}"></script> <!-- since our bundles are in esm format we need to use type="module" -->
				</body>
			</html>
		`;
    }

    protected abstract _getWebview(): vscode.Webview;

    protected setupTheming() {
        this._disposables.push(
            vscode.window.onDidChangeActiveColorTheme((theme) => {
                void this.sendNotification(ColorThemeChangeNotification.type, theme.kind);
            }),
        );
        void this.sendNotification(
            ColorThemeChangeNotification.type,
            vscode.window.activeColorTheme.kind,
        );
    }

    protected setupKeyBindings() {
        this._disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration(Constants.configShortcuts)) {
                    void this.sendNotification(
                        KeyBindingsChangeNotification.type,
                        this.readKeyBindingsConfig(),
                    );
                }
            }),
        );
        void this.sendNotification(
            KeyBindingsChangeNotification.type,
            this.readKeyBindingsConfig(),
        );
    }

    private _registerDefaultRequestHandlers() {
        this.onNotification(
            SendActionEventNotification.type,
            (message: WebviewTelemetryActionEvent) => {
                sendActionEvent(
                    message.telemetryView,
                    message.telemetryAction,
                    message.additionalProps,
                    message.additionalMeasurements,
                );
            },
        );

        this.onNotification(
            SendErrorEventNotification.type,
            (message: WebviewTelemetryErrorEvent) => {
                sendErrorEvent(
                    message.telemetryView,
                    message.telemetryAction,
                    message.error,
                    message.includeErrorMessage,
                    message.errorCode,
                    message.errorType,
                    message.additionalProps,
                    message.additionalMeasurements,
                );
            },
        );

        this.onNotification(LogNotification.type, async (message: LogEvent) => {
            const targetLogger = message.prefix
                ? this.logger.withPrefix(message.prefix)
                : this.logger;
            switch (message.method) {
                case LoggerMethod.PiiSanitized:
                    targetLogger.piiSanitized(
                        message.msg,
                        message.objsToSanitize,
                        message.stringsToShorten,
                        ...(message.vals ?? []),
                    );
                    break;
                case LoggerMethod.Show:
                    targetLogger.show(message.preserveFocus);
                    break;
                case LoggerMethod.Dispose:
                    targetLogger.dispose();
                    break;
                default:
                    targetLogger[message.method](message.message, ...(message.args ?? []));
                    break;
            }
        });

        this.onNotification(LoadStatsNotification.type, (message) => {
            const timeStamp = message.loadCompleteTimeStamp;
            const timeToLoad = timeStamp - this._loadStartTime;
            if (this._isFirstLoad) {
                /**
                 * This notification is sent from the webview when it has finished loading. We use
                 * this to track when the webview is ready to receive messages.
                 */
                this._isWebviewReady = true;
                if (this._webviewReadyTimeoutHandle !== undefined) {
                    clearTimeout(this._webviewReadyTimeoutHandle);
                    this._webviewReadyTimeoutHandle = undefined;
                }
                this._webviewReady.resolve();

                this.logger.trace(
                    `Load stats for ${this._sourceFile}` + "\n" + `Total time: ${timeToLoad} ms`,
                );
                this._endLoadActivity.end(ActivityStatus.Succeeded, {
                    type: this._sourceFile,
                });
                this._isFirstLoad = false;
            }
        });

        this.onRequest(GetStateRequest.type<State>(), () => {
            return this.state;
        });

        this.onRequest(GetThemeRequest.type, () => {
            return vscode.window.activeColorTheme.kind;
        });

        this.onRequest(GetKeyBindingsConfigRequest.type, () => {
            return this.readKeyBindingsConfig();
        });

        this.onRequest(GetLocalizationRequest.type, async () => {
            try {
                return await getLocalizationFileContentsCached();
            } catch (error) {
                const l10nUri = vscode.l10n.uri?.toString() ?? "undefined";
                this.logger.warn(
                    `Failed to read localization file ${l10nUri}: ${getErrorMessage(error)}`,
                );
                return undefined;
            }
        });

        this.onRequest(ExecuteCommandRequest.type, async (params: ExecuteCommandParams) => {
            if (!params?.command) {
                this.logger.trace("No command provided to execute");
                return;
            }
            const args = params?.args ?? [];
            return await vscode.commands.executeCommand(params.command, ...args);
        });

        this.onRequest(GetPlatformRequest.type, async () => {
            return process.platform;
        });

        this.onRequest(ReducerRequest.type<Reducers>(), async (action) => {
            this.logger.debug(`Reducer action received from webview: ${action.type as string}`);
            const reducerActivity = startActivity(
                TelemetryViews.WebviewController,
                TelemetryActions.Reducer,
                undefined, // correlationId
                {
                    type: action.type as string,
                    webviewId: this._sourceFile,
                },
                undefined, // startActivityAdditionalMeasurements
                undefined, // connectionInfo
                undefined, // serverInfo
                true, // include call stack
            );
            const reducer = this._reducerHandlers.get(action.type);
            if (reducer) {
                try {
                    this.state = await reducer(this.state, action.payload);
                    this.logger.debug(`Reducer action succeeded: ${action.type as string}`);
                    reducerActivity.end(ActivityStatus.Succeeded);
                } catch (error) {
                    this.logger.error(
                        `Reducer action failed: ${action.type as string} - ${getErrorMessage(error)}`,
                    );
                    reducerActivity.endFailed(error, false);
                    throw error;
                }
            } else {
                const errorMsg = `No reducer registered for action ${action.type as string}`;
                this.logger.error(errorMsg);
                reducerActivity.endFailed(
                    new Error(errorMsg),
                    true, // include error in telemetry
                );
                throw new Error(errorMsg);
            }
        });

        this.onRequest(GetEOLRequest.type, () => {
            return getEditorEOL();
        });
    }

    /**
     * Reducers are methods that can be called from the webview to modify the state of the webview.
     * This method registers a reducer that can be called from the webview.
     * @param method The method name that the webview will use to call the reducer
     * @param reducer The reducer that will be called when the method is called
     * @template Method The key of the reducer that is being registered
     */
    public registerReducer<Method extends keyof Reducers>(
        method: Method,
        reducer: (state: State, payload: Reducers[Method]) => ReducerResponse<State>,
    ) {
        this._reducerHandlers.set(method, reducer);
    }

    /**
     * Registers a request handler for a specific request type.
     * @param type The request type that the handler will handle
     * @param handler The handler that will be called when the request is made
     */
    public onRequest<TParam, TResult, TError>(
        type: RequestType<TParam, TResult, TError>,
        handler: (params: TParam, token: CancellationToken) => TResult | Promise<TResult>,
    ): void {
        if (!this.connection) {
            return;
        }
        if (this._isDisposed) {
            throw new Error("Cannot register request handler on disposed controller");
        }
        const handlerWrap = (
            params: TParam,
            token: CancellationToken,
        ): TResult | Promise<TResult> => {
            this.logger.debug(`Request received from webview: ${type.method}`);
            // Debug Console diagnostics: one span per webview request gives
            // product-wide coverage of every dialog/designer (Table Designer,
            // Schema Designer, Edit Data, Connection Dialog, Object
            // Management, Schema Compare, ...). Near no-op when no sink is
            // active; method + controller id are protocol metadata.
            // The Debug Console's own RPC traffic (dc/* polling, waterfall and
            // trace queries) is viewer-internal: it must never join the active
            // user-action root trace (it would extend completed scenarios
            // forever) and is excluded from analysis by default.
            const isViewerInternal = this._sourceFile === "debugConsole";
            const diagSpan = diag.anySinkActive
                ? diag.startSpan({
                      feature: `webview.${this._sourceFile}`,
                      kind: "request",
                      type: `webview.${this._sourceFile}.${type.method}`,
                      ...(isViewerInternal
                          ? { traceId: `viewer_${diag.sessionId}`, tags: ["viewerInternal"] }
                          : {}),
                  })
                : undefined;
            const handlerActivity = startActivity(
                TelemetryViews.WebviewController,
                TelemetryActions.OnRequest,
                undefined, // correlationId
                {
                    type: type.method,
                    webviewId: this._sourceFile,
                },
                undefined, // startActivityAdditionalMeasurements
                undefined, // connectionInfo
                undefined, // serverInfo
                true, // include call stack
            );
            try {
                const result = handler(params, token);
                if (result instanceof Promise) {
                    return result.then(
                        (res) => {
                            this.logger.debug(`Request succeeded: ${type.method}`);
                            handlerActivity.end(ActivityStatus.Succeeded);
                            diagSpan?.end("ok");
                            return res;
                        },
                        (error) => {
                            this.logger.error(
                                `Request failed: ${type.method} - ${getErrorMessage(error)}`,
                            );
                            handlerActivity.endFailed(error, false);
                            diagSpan?.fail(error);
                            throw error;
                        },
                    );
                } else {
                    this.logger.debug(`Request succeeded: ${type.method}`);
                    handlerActivity.end(ActivityStatus.Succeeded);
                    diagSpan?.end("ok");
                    return result;
                }
            } catch (error) {
                this.logger.error(`Request failed: ${type.method} - ${getErrorMessage(error)}`);
                handlerActivity.endFailed(error, false);
                diagSpan?.fail(error);
                throw error;
            }
        };
        this.connection.onRequest(type, handlerWrap as RequestHandler<TParam, TResult, TError>);
    }

    /**
     * Registers a reducer that can be called from the webview.
     */
    public sendRequest<TParam, TResult, TError>(
        type: RequestType<TParam, TResult, TError>,
        params: TParam,
        token?: CancellationToken,
    ): Thenable<TResult> {
        if (!this.connection) {
            return;
        }
        if (this._isDisposed) {
            return Promise.reject(new Error("Cannot send request on disposed controller"));
        }
        return this.connection.sendRequest(type, params as RequestParam<TParam>, token);
    }

    /**
     * Sends a notification to the webview. This is used to notify the webview of changes
     * @param type The notification type that the webview will handle
     * @param params The parameters that will be passed to the notification handler
     */
    public sendNotification<TParams>(
        type: NotificationType<TParams>,
        params: TParams,
    ): Promise<void> {
        if (!this.connection) {
            return Promise.resolve();
        }
        if (this._isDisposed) {
            // A disposed webview can't receive anything: dropping the
            // notification is the only correct delivery. Throwing here made
            // in-flight work fail AFTER its real outcome (e.g. the connection
            // dialog's post-connect state push raced its own auto-close and
            // reported "Cannot send notification on disposed controller").
            return Promise.resolve();
        }
        sendActionEvent(
            TelemetryViews.WebviewController,
            TelemetryActions.SendNotification,
            {
                type: type.method,
                webviewId: this._sourceFile,
            },
            undefined,
            undefined,
            undefined,
            true, // include call stack
        );
        return this.connection.sendNotification(type, params as RequestParam<TParams>);
    }

    /**
     * Registers a notification handler for a specific notification type.
     * This handler will be called when the webview sends a notification of that type.
     * @param type The notification type that the handler will handle
     * @param handler The handler that will be called when the notification is received
     */
    public onNotification<TParams>(
        type: NotificationType<TParams>,
        handler: (params: TParams) => void,
    ): void {
        if (!this.connection) {
            return;
        }
        if (this._isDisposed) {
            throw new Error("Cannot register notification handler on disposed controller");
        }
        sendActionEvent(
            TelemetryViews.WebviewController,
            TelemetryActions.onNotification,
            {
                type: type.method,
                webviewId: this._sourceFile,
            },
            undefined,
            undefined,
            undefined,
            true, // include call stack
        );
        this.connection.onNotification(type, handler);
    }

    /**
     * Gets the state object that the webview is using
     */
    public get state(): State {
        return this._state;
    }

    /**
     * Sets the state object that the webview is using. This will update the state in the webview
     * and may cause the webview to re-render.
     * @param value The new state object
     */
    public set state(value: State) {
        this._state = value;
        void this.sendNotification(StateChangeNotification.type<State>(), value);
    }

    /**
     * Updates the state in the webview
     * @param state The new state object.  If not provided, `this.state` is used.
     */
    public updateState(state?: State) {
        this.state = state ?? this.state;
    }

    /**
     * Gets whether the controller has been disposed
     */
    public get isDisposed(): boolean {
        return this._isDisposed;
    }

    /**
     * Posts a message to the webview
     * @param message The message to post to the webview
     */
    public postMessage(message: WebviewRpcMessage) {
        if (!this._isDisposed) {
            this._getWebview()?.postMessage(message);
        }
    }

    /**
     * Disposes the controller
     */
    public dispose() {
        this._onDisposed.fire();
        this._disposables.forEach((d) => d.dispose());
        this._isDisposed = true;
        if (this._webviewReadyTimeoutHandle !== undefined) {
            clearTimeout(this._webviewReadyTimeoutHandle);
            this._webviewReadyTimeoutHandle = undefined;
        }
        this._webviewReady.reject(new Error(LocalizedConstants.Webview.webviewDisposedBeforeReady));
    }

    /**
     * Waits for the webview to become ready. This is useful for ensuring that the webview is ready to receive messages before sending any.
     * @param timeoutMs Optional timeout in milliseconds to wait for the webview to become ready. Defaults to 5 seconds.
     * @returns A promise that resolves when the webview is ready or rejects if there is an error or timeout.
     */
    public whenWebviewReady(timeoutMs: number = WEBVIEW_INIT_TIMEOUT_MS): Promise<void> {
        if (this._isWebviewReady) {
            return Promise.resolve();
        }

        if (this._webviewReadyTimeoutHandle === undefined) {
            this._webviewReadyTimeoutHandle = setTimeout(() => {
                this._webviewReadyTimeoutHandle = undefined;
                this._webviewReady.reject(
                    new Error(
                        LocalizedConstants.Webview.webviewNotReadyTimeout(
                            this._sourceFile,
                            timeoutMs,
                        ),
                    ),
                );
            }, timeoutMs);
        }

        return this._webviewReady.promise;
    }

    private readKeyBindingsConfig(): Record<string, string> {
        return (
            vscode.workspace
                .getConfiguration()
                ?.get<Record<string, string>>(Constants.configShortcuts) ?? {}
        );
    }
}

export type ReducerResponse<T> = T | Promise<T>;

/**
 * BOOT-2: static-closure chunk names per webview entry, from the manifest
 * the bundler emits beside the views. Read once, cached for the process —
 * missing manifest (older build) degrades to no preloads, never a throw.
 */
let preloadManifest: Record<string, string[]> | undefined | null;

function preloadChunksFor(extensionPath: string, sourceFile: string): string[] {
    if (preloadManifest === undefined) {
        try {
            preloadManifest = JSON.parse(
                fs.readFileSync(
                    path.join(extensionPath, "dist", "views", "preload-manifest.json"),
                    "utf8",
                ),
            ) as Record<string, string[]>;
        } catch {
            preloadManifest = null;
        }
    }
    return preloadManifest?.[sourceFile] ?? [];
}
