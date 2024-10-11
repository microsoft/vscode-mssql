/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";

import { TelemetryActions, TelemetryViews } from "./telemetry";

export enum ApiStatus {
    NotStarted = "notStarted",
    Loading = "loading",
    Loaded = "loaded",
    Error = "error",
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
