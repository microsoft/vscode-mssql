/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum TelemetryViews {
    ObjectExplorer = "ObjectExplorer",
    CommandPalette = "CommandPalette",
    SqlProjects = "SqlProjects",
    QueryEditor = "QueryEditor",
    QueryResult = "QueryResult", // react query result pane
    ResultsGrid = "ResultsGrid", // angular results grid
    ConnectionPrompt = "ConnectionPrompt",
    WebviewController = "WebviewController",
    ObjectExplorerFilter = "ObjectExplorerFilter",
    TableDesigner = "TableDesigner",
    UserSurvey = "UserSurvey",
    General = "General",
    ConnectionDialog = "ConnectionDialog",
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
    SurveySubmit = "SurveySubmit",
    SaveResults = "SaveResults",
    CopyResults = "CopyResults",
    CopyResultsHeaders = "CopyResultsHeaders",
    CopyHeaders = "CopyHeaders",
    EnableRichExperiencesPrompt = "EnableRichExperiencesPrompt",
    Restore = "Restore",
    LoadConnection = "LoadConnection",
    LoadAzureServers = "LoadAzureServers",
    LoadConnectionProperties = "LoadConnectionProperties",
    LoadRecentConnections = "LoadRecentConnections",
    LoadAzureSubscriptions = "LoadAzureSubscriptions",
}
