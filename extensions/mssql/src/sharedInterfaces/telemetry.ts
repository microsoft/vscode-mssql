/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscodeMssql from "vscode-mssql";
import { IConnectionDialogProfile } from "./connectionDialog";

export enum TelemetryViews {
    ObjectExplorer = "ObjectExplorer",
    CommandPalette = "CommandPalette",
    SqlProjects = "SqlProjects",
    QueryEditor = "QueryEditor",
    /** react query result pane */
    QueryResult = "QueryResult",
    /** angular results grid */
    ResultsGrid = "ResultsGrid",
    ConnectionPrompt = "ConnectionPrompt",
    WebviewController = "WebviewController",
    ObjectExplorerFilter = "ObjectExplorerFilter",
    Deployment = "Deployment",
    LocalContainers = "LocalContainers",
    FabricProvisioning = "FabricProvisioning",
    TableDesigner = "TableDesigner",
    SchemaCompare = "SchemaCompare",
    UserSurvey = "UserSurvey",
    General = "General",
    ConnectionDialog = "ConnectionDialog",
    ExecutionPlan = "ExecutionPlan",
    AddFirewallRule = "AddFirewallRule",
    MssqlCopilot = "MssqlCopilot",
    AzureAccountManagement = "AzureAccountManagement",
    ConnectionGroup = "ConnectionGroup",
    SchemaDesigner = "SchemaDesigner",
    Connection = "Connection",
    Credential = "Credential",
    ConnectionManager = "ConnectionManager",
    DacpacDialog = "DacpacDialog",
    ScriptingService = "ScriptingService",
    TableExplorer = "TableExplorer",
    ChangelogPage = "ChangelogPage",
}

export enum TelemetryActions {
    GetDatabaseProjectScriptFiles = "GetDatabaseProjectScriptFiles",
    GetDatabaseProjectSchemaProvider = "GetDatabaseProjectSchemaProvider",
    ListingDatabasesForActiveServer = "ListingDatabasesForActiveServer",
    IncludeExcludeAllNodes = "IncludeExcludeAllNodes",
    IncludeExcludeNode = "IncludeExcludeNode",
    PublishProjectChanges = "PublishProjectChanges",
    PublishDatabaseChanges = "PublishDatabaseChanges",
    BuildProject = "BuildProject",
    AddNewConnectionDialogOpened = "AddNewConnectionDialogOpened",
    ListingActiveServers = "ListingActiveServers",
    SqlProjectInstalledVerification = "SqlProjectInstalledVerification",
    Compare = "Compare",
    Switch = "Switch",
    OpenScmp = "OpenScmp",
    SaveScmp = "SaveScmp",
    OptionsChanged = "OptionsChanged",
    RunCompareAfterChangingOptions = "RunCompareAfterChangingOptions",
    ResetOptions = "ResetOptions",
    Activated = "Activated",
    GenerateScript = "GenerateScript",
    Refresh = "Refresh",
    CreateProject = "CreateProject",
    PublishDialogOpened = "PublishDialogOpened",
    PublishProject = "PublishProject",
    PublishProjectProperties = "PublishProjectProperties",
    PublishDialogLocalContainersPrerequisites = "PublishDialogLocalContainersPrerequisites",
    PublishDialogCreateLocalContainers = "PublishDialogCreateLocalContainers",
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
    ReceivedFromWebview = "ReceivedFromWebview",
    SentToWebview = "SentToWebview",
    Reducer = "Reducer",
    Open = "Open",
    Submit = "Submit",
    Cancel = "Cancel",
    Initialize = "Initialize",
    Edit = "Edit",
    Publish = "Publish",
    ContinueEditing = "ContinueEditing",
    Close = "Close",
    SurveySubmit = "SurveySubmit",
    PublishProfileLoaded = "PublishProfileLoaded",
    PublishProfileSaved = "PublishProfileSaved",
    PublishProjectConnectionError = "PublishProjectConnection",
    GenerateSqlPackageCommand = "GenerateSqlPackageCommand",
    SaveResults = "SaveResults",
    CopyResults = "CopyResults",
    CopyResultsHeaders = "CopyResultsHeaders",
    CopyHeaders = "CopyHeaders",
    EnableRichExperiencesPrompt = "EnableRichExperiencesPrompt",
    OpenQueryResultsInTabByDefaultPrompt = "OpenQueryResultsInTabByDefaultPrompt",
    OpenQueryResult = "OpenQueryResult",
    Restore = "Restore",
    LoadConnection = "LoadConnection",
    LoadAzureServers = "LoadAzureServers",
    LoadConnectionProperties = "LoadConnectionProperties",
    LoadRecentConnections = "LoadRecentConnections",
    LoadAzureSubscriptions = "LoadAzureSubscriptions",
    OpenExecutionPlan = "OpenExecutionPlan",
    LoadAzureAccountsForEntraAuth = "LoadAzureAccountsForEntraAuth",
    LoadAzureTenantsForEntraAuth = "LoadAzureTenantsForEntraAuth",
    LoadConnections = "LoadConnections",
    AddFirewallRule = "AddFirewallRule",
    SubmitGithubIssue = "SubmitGithubIssue",
    AutoColumnSize = "AutoColumnSize",
    DisableLanguageServiceForNonTSqlFiles = "DisableLanguageServiceForNonTSqlFiles",
    OpenDeployment = "OpenDeploymentDialog",
    StartLocalContainersDeployment = "StartLocalContainersDeployment",
    FinishLocalContainersDeployment = "FinishLocalContainersDeployment",
    StartFabricProvisioningDeployment = "StartFabricProvisioningDeployment",
    FinishFabricProvisioningDeployment = "FinishFabricProvisioningDeployment",
    StartDocker = "StartDocker",
    SubmitContainerForm = "SubmitContainerForm",
    ConnectToContainer = "ConnectToContainer",
    StopContainer = "StopContainer",
    DeleteContainer = "DeleteContainer",
    RestartContainer = "RestartContainer",
    PullImage = "PullImage",
    RunDockerStep = "RunDockerStep",
    RetryDockerStep = "RetryDockerStep",
    GetWorkspaces = "GetWorkspaces",
    LoadCapacities = "LoadCapacities",
    GetWorkspaceRole = "GetWorkspaceRole",
    GetPermissionsForWorkspaces = "GetPermissionsForWorkspaces",
    GetFabricDatabases = "GetFabricDatabases",
    ProvisionFabricDatabase = "ProvisionFabricDatabase",
    ConnectToFabricDatabase = "ConnectToFabricDatabase",
    LoadFromConnectionString = "LoadFromConnectionString",
    MigrateLegacyConnections = "MigrateLegacyConnections",
    FilterAzureSubscriptions = "FilterAzureSubscriptions",
    ScriptNode = "ScriptNode",
    CreateSession = "CreateSession",
    ExplainQuery = "ExplainQuery",
    RewriteQuery = "RewriteQuery",
    AnalyzeQueryPerformance = "AnalyzeQueryPerformance",
    Error = "Error",
    ToolCall = "ToolCall",
    ToolCallFailure = "ToolCallFailure",
    Feedback = "Feedback",
    ChatWithDatabase = "ChatWithDatabase",
    ChatWithDatabaseInAgentMode = "ChatWithDatabaseInAgentMode",
    StartConversation = "StartConversation",
    AzureSignIn = "AzureSignIn",
    GetQueryResultState = "GetQueryResultState",
    SavePlan = "SavePlan",
    CopilotAgentModeToolCall = "CopilotAgentModeToolCall",
    SaveConnectionGroup = "SaveConnectionGroup",
    DragAndDrop = "DragAndDrop",
    ExportToImage = "ExportToImage",
    GetReport = "GetReport",
    PublishSession = "PublishSession",
    GetDefinition = "GetDefinition",
    LookupPassword = "LookupPassword",
    ChatCommand = "ChatCommand",
    ReadCredential = "ReadCredential",
    Connect = "Connect",
    LoadFabricWorkspaces = "LoadFabricWorkspaces",
    LoadDatabases = "LoadDatabases",
    GetSqlAnalyticsEndpointUrlFromFabric = "GetSqlAnalyticsEndpointUrlFromFabric",
    SurveyFunnel = "SurveyFunnel",
    CopilotNewQueryWithConnection = "CopilotNewQueryWithConnection",
    DacpacDialogDeployDacpac = "DacpacDialogDeployDacpac",
    DacpacDialogExtractDacpac = "DacpacDialogExtractDacpac",
    DacpacDialogImportBacpac = "DacpacDialogImportBacpac",
    DacpacDialogExportBacpac = "DacpacDialogExportBacpac",
    Script = "Script",
    CommitChanges = "CommitChanges",
    CreateRow = "CreateRow",
    DeleteRow = "DeleteRow",
    UpdateCell = "UpdateCell",
    RevertCell = "RevertCell",
    RevertRow = "RevertRow",
    LoadSubset = "LoadSubset",
    OpenLink = "OpenLink",
    ExecuteCommand = "ExecuteCommand",
    ChangelogDontShowAgain = "ChangelogDontShowAgain",
    CloseChangelog = "CloseChangelog",
    OnRequest = "OnRequest",
    CancelQuery = "CancelQuery",
    GetResultRowsSubset = "GetResultRowsSubset",
    CancelConnection = "CancelConnection",
    SendNotification = "SendNotification",
    onNotification = "onNotification",
    RefreshEntraToken = "RefreshEntraToken",
}

/**
 * The status of an activity
 */
export enum ActivityStatus {
    Succeeded = "Succeeded",
    Pending = "Pending",
    Failed = "Failed",
    Canceled = "Canceled",
    Retrying = "Retrying",
}

/**
 * Finish an activity. This should be called when the activity is complete to send the final telemetry event
 */
export type FinishActivity = (
    activityStatus: Exclude<ActivityStatus, ActivityStatus.Failed>,
    additionalProperties?: Record<string, string>,
    additionalMeasurements?: Record<string, number>,
    connectionProfile?: any, //TODO fix any with IConnectionProfile
    serverInfo?: vscodeMssql.IServerInfo,
) => void;

/**
 * Finish an activity with a failure. This should be called when the activity fails to send the final telemetry event
 */
export type FinishActivityFailed = (
    error?: Error,
    includeErrorMessage?: boolean,
    errorCode?: string,
    errorType?: string,
    additionalProperties?: Record<string, string>,
    additionalMeasurements?: Record<string, number>,
    connectionProfile?: IConnectionDialogProfile,
    serverInfo?: vscodeMssql.IServerInfo,
) => void;

/**
 * Update an activity. This should be called when the activity is still in progress to send intermediate telemetry events
 */
export type UpdateActivity = (
    additionalProperties?: Record<string, string>,
    additionalMeasurements?: Record<string, number>,
    connectionProfile?: any, //TODO fix any with IConnectionProfile
    serverInfo?: vscodeMssql.IServerInfo,
) => void;

/**
 * An object that contains the functions to update and finish an activity. This is returned when an activity is started
 */
export type ActivityObject = {
    /**
     * Update the activity with additional properties and measurements
     */
    update: UpdateActivity;
    /**
     * Finish the activity
     */
    end: FinishActivity;
    /**
     * Finish the activity with a failure
     */
    endFailed: FinishActivityFailed;
    /**
     * The correlation id for the activity
     */
    correlationId: string;
    /**
     * The start time of the activity generated by performance.now()
     */
    startTime: number;
};
