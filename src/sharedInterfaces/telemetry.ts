/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum TelemetryViews {
    ObjectExplorer = "ObjectExplorer",
    CommandPalette = "CommandPalette",
    SqlProjects = "SqlProjects",
    QueryEditor = "QueryEditor",
    ResultsGrid = "ResultsGrid",
    ConnectionPrompt = "ConnectionPrompt",
    WebviewController = "WebviewController",
    ObjectExplorerFilter = "ObjectExplorerFilter",
    TableDesigner = "TableDesigner",
}

export enum TelemetryActions {
    GenerateScript = "GenerateScript",
    Refresh = "Refresh",
    CreateProject = "CreateProject",
    RemoveConnection = "RemoveConnection",
    Disconnect = "Disconnect",
    NewQuery = "NewQuery",
    RunQuery = "RunQuery",
    QueryExecutionCompleted = "QueryExecutionCompleted",
    RunResultPaneAction = "RunResultPaneAction",
    CreateConnection = "CreateConnection",
    CreateConnectionResult = "CreateConnectionResult",
    ExpandNode = "ExpandNode",
    ResultPaneAction = "ResultPaneAction",
    Load = "Load",
    WebviewRequest = "WebviewRequest",
    Open = "Open",
    Submit = "Submit",
    Cancel = "Cancel",
    Initialize = "Initialize",
    Edit = "Edit",
    Publish = "Publish",
    ContinueEditing = "ContinueEditing",
    Close = "Close",
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
