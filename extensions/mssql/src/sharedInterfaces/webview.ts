/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TelemetryActions, TelemetryViews } from "./telemetry";
import { NotificationType, RequestType } from "vscode-jsonrpc/browser";

/**
 * Enum to represent the status of an asynchronous call or operation.
 * Use directly (plus an errorMessage property on the state) if the error message
 * will be shown in a generic area (like a banner at the top).  Otherwise, use `Status`.
 */
export enum ApiStatus {
    NotStarted = "notStarted",
    Loading = "loading",
    Loaded = "loaded",
    Error = "error",
}

/**
 * Expanded interface to represent the status of an asynchronous call or operation, including a message.
 * Use this interface when you need to display the message in a specific location, like next to the component doing the loading.
 */
export interface Status {
    status: ApiStatus;
    message?: string;
}

export interface WebviewTelemetryActionEvent {
    /**
     * The view in which the event occurred.
     */
    telemetryView: TelemetryViews;
    /**
     * The action that was being performed when the event occurred.
     */
    telemetryAction: TelemetryActions;
    /**
     * Additional properties for the event.
     */
    additionalProps?: Record<string, string>;
    /**
     * Additional measurements for the event.
     */
    additionalMeasurements?: Record<string, number>;
}

export interface WebviewTelemetryErrorEvent {
    /**
     * The view in which the event occurred.
     */
    telemetryView: TelemetryViews;
    /**
     * The action that was being performed when the event occurred.
     */
    telemetryAction: TelemetryActions;
    /**
     * Error that occurred.
     */
    error: Error;
    /**
     * Whether to include the error message in the telemetry event. Defaults to false.
     */
    includeErrorMessage: boolean;
    /**
     * Error code for the error.
     */
    errorCode?: string;
    /**
     * Error type for the error.
     */
    errorType?: string;
    /**
     * Additional properties to include in the telemetry event.
     */
    additionalProps?: Record<string, string>;
    /**
     * Additional measurements to include in the telemetry event.
     */
    additionalMeasurements?: Record<string, number>;
}

/**
 * Options for customizing a webview panel. Since vscode has an interface with the same name, this
 * interface is prefixed with Mssql to avoid conflicts.
 */
export interface MssqlWebviewPanelOptions {
    /**
     * The title of the webview panel.
     */
    title: string;
    /**
     * The view column in which the webview panel should be displayed.
     */
    viewColumn: vscode.ViewColumn;
    /**
     * Whether the focus should be preserved when the webview is revealed.
     */
    preserveFocus?: boolean;
    /**
     * The icon path for the webview panel tab icon.
     */
    iconPath?:
        | vscode.Uri
        | {
              readonly light: vscode.Uri;
              readonly dark: vscode.Uri;
          };
    /**
     * When the webview panel is disposed, there is a prompt shown to restore it.
     * This option is useful when the user accidentally closes the webview panel.
     * By default, the webview panel is disposed when it is closed.
     * Note: Use this option with caution and only on webview panels that have a significant amount of state.
     * As it can be frustrating for users to see the restore prompt for every webview panel.
     */
    showRestorePromptAfterClose?: boolean;
}

export interface LogEvent {
    message: string;
    level: LoggerLevel;
}

export type LogCallback = (message: string, level?: LoggerLevel) => void;

// Names of the logging level methods (not the enums) in the Logger class
export type LoggerLevel = "critical" | "error" | "warn" | "info" | "verbose" | "log";

export enum ColorThemeKind {
    Light = 1,
    Dark = 2,
    HighContrast = 3,
    HighContrastLight = 4,
}

export interface WebviewContextProps<TState> {
    /**
     * Whether localized strings have been loaded for the webview
     */
    //isLocalizationLoaded: boolean; // TODO: this appears to be unused; confirm with Aasim if it can be removed
    /**
     * State of the webview.
     */
    state: TState;
    /**
     * Theme of the webview.
     */
    themeKind: ColorThemeKind;
    /**
     * Key bindings for the webview.
     */
    keyBindings: WebviewKeyBindings;
    log(message: string, level?: LoggerLevel): void;
    sendActionEvent(event: WebviewTelemetryActionEvent): void;
    sendErrorEvent(event: WebviewTelemetryErrorEvent): void;
}

export enum MessageType {
    Request = "request",
    Response = "response",
    Notification = "notification",
}

export interface WebviewRpcMessage {
    type: MessageType;
    id?: string;
    method?: string;
    params?: unknown;
    result?: unknown;
    error?: Error;
}

/**
 * Color theme change event callback declaration.
 */
export namespace ColorThemeChangeNotification {
    export const type = new NotificationType<ColorThemeKind>("onDidChangeColorTheme");
}

/**
 * Key bindings change event callback declaration.
 * This is used to notify the webview of key binding changes.
 */
export namespace KeyBindingsChangeNotification {
    export const type = new NotificationType<WebviewKeyBindingConfiguration>(
        "onDidChangeKeyBindings",
    );
}

/**
 * State change event callback declaration.
 * This is used to notify the webview of state changes that it should be aware of.
 */
export namespace StateChangeNotification {
    const TYPE = new NotificationType("onDidChangeState");
    export function type<State>() {
        return TYPE as NotificationType<State>;
    }
}

/**
 * Request to get the current state of the webview.
 */
export namespace GetStateRequest {
    const TYPE = new RequestType<void, void, void>("getState");
    export function type<State>() {
        return TYPE as RequestType<void, State, void>;
    }
}

/**
 * Request to get the current color theme of vscode.
 */
export namespace GetThemeRequest {
    export const type = new RequestType<void, ColorThemeKind, void>("getTheme");
}

/**
 * Request to get key bindings for the webview.
 */
export namespace GetKeyBindingsConfigRequest {
    export const type = new RequestType<void, WebviewKeyBindingConfiguration, void>(
        "getKeyBindingsConfig",
    );
}

/**
 * Request to get localized strings for the webview.
 */
export namespace GetLocalizationRequest {
    export const type = new RequestType<void, string, void>("getLocalization");
}

/**
 * Parameters for executing a command in the extension host from the webview.
 */
export interface ExecuteCommandParams {
    command: string;
    args?: any[];
}

/**
 * Request to execute a command in the extension host from the webview.
 */
export namespace ExecuteCommandRequest {
    export const type = new RequestType<ExecuteCommandParams, void, void>("executeCommand");
}

/**
 * Request from the webview to get the platform information.
 */
export namespace GetPlatformRequest {
    export const type = new RequestType<void, string, void>("getPlatform");
}

/**
 * Notification to send an action event from the webview to the controller.
 */
export namespace SendActionEventNotification {
    export const type = new NotificationType<WebviewTelemetryActionEvent>("sendActionEvent");
}

/**
 * Notification to send an error event from the webview to the controller.
 */
export namespace SendErrorEventNotification {
    export const type = new NotificationType<WebviewTelemetryErrorEvent>("sendErrorEvent");
}

/**
 * Notification to log a message from the webview to the controller.
 */
export namespace LogNotification {
    export const type = new NotificationType<LogEvent>("log");
}

export namespace ReducerRequest {
    export function type<Reducers>() {
        return new RequestType<
            { type: keyof Reducers; payload?: Reducers[keyof Reducers] },
            unknown,
            void
        >("action");
    }
}

export interface LoadStatsParams {
    loadCompleteTimeStamp: number;
}

export namespace LoadStatsNotification {
    export const type = new NotificationType<LoadStatsParams>("loadStats");
}

export interface PendingRequest {
    resolve: (result: any) => void;
    reject: (error: any) => void;
}

export namespace GetEOLRequest {
    export const type = new RequestType<void, string, void>("getEOL");
}

export interface CoreRPCs {
    log(message: string, level?: LoggerLevel): void;
    sendActionEvent(event: WebviewTelemetryActionEvent): void;
    sendErrorEvent(event: WebviewTelemetryErrorEvent): void;
}

export enum WebviewAction {
    QueryResultSwitchToResultsTab = "event.queryResults.switchToResultsTab",
    QueryResultSwitchToMessagesTab = "event.queryResults.switchToMessagesTab",
    QueryResultSwitchToQueryPlanTab = "event.queryResults.switchToQueryPlanTab",
    QueryResultPrevGrid = "event.queryResults.prevGrid",
    QueryResultNextGrid = "event.queryResults.nextGrid",
    QueryResultSwitchToTextView = "event.queryResults.switchToTextView",
    QueryResultMaximizeGrid = "event.queryResults.maximizeGrid",
    QueryResultSaveAsJson = "event.queryResults.saveAsJSON",
    QueryResultSaveAsCsv = "event.queryResults.saveAsCSV",
    QueryResultSaveAsExcel = "event.queryResults.saveAsExcel",
    QueryResultSaveAsInsert = "event.queryResults.saveAsInsert",
    ResultGridCopySelection = "event.resultGrid.copySelection",
    ResultGridCopyWithHeaders = "event.resultGrid.copyWithHeaders",
    ResultGridCopyAllHeaders = "event.resultGrid.copyAllHeaders",
    ResultGridSelectAll = "event.resultGrid.selectAll",
    ResultGridCopyAsCsv = "event.resultGrid.copyAsCSV",
    ResultGridCopyAsJson = "event.resultGrid.copyAsJSON",
    ResultGridCopyAsInsert = "event.resultGrid.copyAsInsert",
    ResultGridCopyAsInClause = "event.resultGrid.copyAsInClause",
    ResultGridChangeColumnWidth = "event.resultGrid.changeColumnWidth",
    ResultGridExpandSelectionLeft = "event.resultGrid.expandSelectionLeft",
    ResultGridExpandSelectionRight = "event.resultGrid.expandSelectionRight",
    ResultGridExpandSelectionUp = "event.resultGrid.expandSelectionUp",
    ResultGridExpandSelectionDown = "event.resultGrid.expandSelectionDown",
    ResultGridOpenColumnMenu = "event.resultGrid.openColumnMenu",
    ResultGridOpenFilterMenu = "event.resultGrid.openFilterMenu",
    ResultGridMoveToRowStart = "event.resultGrid.moveToRowStart",
    ResultGridMoveToRowEnd = "event.resultGrid.moveToRowEnd",
    ResultGridSelectColumn = "event.resultGrid.selectColumn",
    ResultGridSelectRow = "event.resultGrid.selectRow",
    ResultGridToggleSort = "event.resultGrid.toggleSort",
}

/**
 * Keyboard shortcut configuration for webview actions.
 */
export type WebviewKeyBindingConfiguration = Record<WebviewAction, string>;

/**
 * Representation of a key combination for a webview shortcut.
 */
export interface WebviewKeyCombination {
    key?: string;
    code?: string;
    ctrlKey?: boolean;
    shiftKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
}

/**
 * Representation of a webview shortcut including its key combination and label.
 */
export interface WebviewKeyBinding {
    keyCombination: WebviewKeyCombination;
    label: string;
}

/**
 * Collection of webview shortcuts mapped by their actions.
 */
export type WebviewKeyBindings = Record<WebviewAction, WebviewKeyBinding>;
