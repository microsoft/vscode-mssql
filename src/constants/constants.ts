/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Collection of Non-localizable Constants
export const languageId = "sql";
export const extensionId = "ms-mssql.mssql";
export const extensionName = "mssql";
export const extensionConfigSectionName = "mssql";
export const telemetryConfigSectionName = "telemetry";
export const mssqlProviderName = "MSSQL";
export const mssqlChatParticipantName = "mssql"; // must be the same as the one in package.json
export const noneProviderName = "None";
export const objectExplorerId = "objectExplorer";
export const queryHistory = "queryHistory";
export const connectionApplicationName = "vscode-mssql";
export const outputChannelName = "MSSQL";
export const connectionConfigFilename = "settings.json";
export const connectionsArrayName = "connections";
export const connectionGroupsArrayName = "connectionGroups";
export const disconnectedServerNodeType = "disconnectedServer";
export const disconnected = "disconnected";
export const serverLabel = "Server";
export const disconnectedDockerContainer = "disconnectedDockerContainer";
export const dockerContainer = "DockerContainer";
export const folderLabel = "Folder";
export const database_green = "Database_green";
export const database_red = "Database_red";
export const cmdRunQuery = "mssql.runQuery";
export const cmdRunCurrentStatement = "mssql.runCurrentStatement";
export const cmdCancelQuery = "mssql.cancelQuery";
export const cmdrevealQueryResult = "mssql.revealQueryResult";
export const cmdCopyAll = "mssql.copyAll";
export const cmdConnect = "mssql.connect";
export const cmdDisconnect = "mssql.disconnect";
export const cmdChangeDatabase = "mssql.changeDatabase";
export const cmdChooseDatabase = "mssql.chooseDatabase";
export const cmdChooseLanguageFlavor = "mssql.chooseLanguageFlavor";
export const cmdShowReleaseNotes = "mssql.showReleaseNotes";
export const cmdShowGettingStarted = "mssql.showGettingStarted";
export const cmdRefreshQueryHistory = "mssql.refreshQueryHistory";
export const cmdClearAllQueryHistory = "mssql.clearAllQueryHistory";
export const cmdDeleteQueryHistory = "mssql.deleteQueryHistory";
export const cmdOpenQueryHistory = "mssql.openQueryHistory";
export const cmdRunQueryHistory = "mssql.runQueryHistory";
export const cmdStartQueryHistory = "mssql.startQueryHistoryCapture";
export const cmdPauseQueryHistory = "mssql.pauseQueryHistoryCapture";
export const cmdCommandPaletteQueryHistory = "mssql.commandPaletteQueryHistory";
export const cmdNewQuery = "mssql.newQuery";
export const cmdSchemaCompare = "mssql.schemaCompare";
export const cmdSchemaCompareOpenFromCommandPalette = "mssql.schemaCompareOpenFromCommandPalette";
export const cmdManageConnectionProfiles = "mssql.manageProfiles";
export const cmdClearPooledConnections = "mssql.clearPooledConnections";
export const cmdRebuildIntelliSenseCache = "mssql.rebuildIntelliSenseCache";
export const cmdAddObjectExplorer = "mssql.addObjectExplorer";
export const cmdAddObjectExplorerLegacy = "mssql.addObjectExplorerLegacy";
export const cmdConnectionGroupCreate = "mssql.connectionGroups.create";
export const cmdConnectionGroupEdit = "mssql.connectionGroups.edit";
export const cmdConnectionGroupDelete = "mssql.connectionGroups.delete";
export const cmdObjectExplorerNewQuery = "mssql.objectExplorerNewQuery";
export const cmdChatWithDatabase = "mssql.objectExplorerChatWithDatabase";
export const cmdChatWithDatabaseInAgentMode = "mssql.objectExplorerChatWithDatabaseInAgentMode";
export const cmdExplainQuery = "mssql.copilot.explainQuery";
export const cmdRewriteQuery = "mssql.copilot.rewriteQuery";
export const cmdAnalyzeQueryPerformance = "mssql.copilot.analyzeQueryPerformance";
export const cmdRemoveObjectExplorerNode = "mssql.removeObjectExplorerNode";
export const cmdRefreshObjectExplorerNode = "mssql.refreshObjectExplorerNode";
export const cmdDisconnectObjectExplorerNode = "mssql.disconnectObjectExplorerNode";
export const cmdObjectExplorerNodeSignIn = "mssql.objectExplorerNodeSignIn";
export const cmdConnectObjectExplorerNode = "mssql.connectObjectExplorerNode";
export const cmdConnectObjectExplorerProfile = "mssql.connectObjectExplorerProfile";
export const cmdOpenObjectExplorerCommand = "workbench.view.extension.objectExplorer";
export const cmdObjectExplorerGroupBySchemaFlagName = "mssql.objectExplorer.groupBySchema";
export const cmdObjectExplorerEnableGroupBySchemaCommand =
    "mssql.objectExplorer.enableGroupBySchema";
export const cmdObjectExplorerDisableGroupBySchemaCommand =
    "mssql.objectExplorer.disableGroupBySchema";
export const cmdObjectExplorerCollapseOrExpandByDefault =
    "objectExplorer.collapseConnectionGroupsOnStartup";
export const cmdEnableRichExperiencesCommand = "mssql.enableRichExperiences";
export const cmdScriptSelect = "mssql.scriptSelect";
export const cmdScriptCreate = "mssql.scriptCreate";
export const cmdScriptDelete = "mssql.scriptDelete";
export const cmdScriptExecute = "mssql.scriptExecute";
export const cmdScriptAlter = "mssql.scriptAlter";
export const cmdToggleSqlCmd = "mssql.toggleSqlCmd";
export const cmdCopyObjectName = "mssql.copyObjectName";
export const cmdFilterNode = "mssql.filterNode";
export const cmdFilterNodeWithExistingFilters = "mssql.filterNodeWithExistingFilters";
export const cmdClearFilters = "mssql.clearFilters";
export const cmdSearchObjects = "mssql.searchObjects";
export const cmdOpenExtension = "extension.open";
export const cmdLoadCompletionExtension = "mssql.loadCompletionExtension";
export const cmdAzureSignIn = "azure-account.login";
export const cmdAzureSignInWithDeviceCode = "azure-account.loginWithDeviceCode";
export const cmdAzureSignInToCloud = "azure-account.loginToCloud";
export const cmdAadRemoveAccount = "mssql.removeAadAccount";
export const cmdAadAddAccount = "mssql.addAadAccount";
export const cmdClearAzureTokenCache = "mssql.clearAzureAccountTokenCache";
export const vscodeWorkbenchChatOpenAgent = "workbench.action.chat.openagent";
export const vscodeWorkbenchChatOpenAgentLegacy = "workbench.action.chat.openAgent";
export const cmdShowEstimatedPlan = "mssql.showEstimatedPlan";
export const cmdEnableActualPlan = "mssql.enableActualPlan";
export const cmdDisableActualPlan = "mssql.disableActualPlan";
export const cmdNewTable = "mssql.newTable";
export const cmdEditTable = "mssql.editTable";
export const cmdEditConnection = "mssql.editConnection";
export const cmdLaunchUserFeedback = "mssql.userFeedback";
export const cmdDesignSchema = "mssql.schemaDesigner";
export const cmdDeployNewDatabase = "mssql.deployNewDatabase";
export const cmdStopContainer = "mssql.stopContainer";
export const cmdDeleteContainer = "mssql.deleteContainer";
export const cmdStartContainer = "mssql.startContainer";
export const piiLogging = "piiLogging";
export const mssqlPiiLogging = "mssql.piiLogging";
export const enableSqlAuthenticationProvider = "mssql.enableSqlAuthenticationProvider";
export const enableConnectionPooling = "mssql.enableConnectionPooling";
export const sqlDbSuffix = ".database.windows.net";
export const defaultConnectionTimeout = 15;
export const azureSqlDbConnectionTimeout = 30;
export const defaultCommandTimeout = 30;
export const azureDatabase = "Azure";
export const azureMfa = "AzureMFA";
export const defaultPortNumber = 1433;
export const integratedauth = "Integrated";
export const sqlAuthentication = "SqlLogin";
export const defaultDatabase = "master";
export const errorPasswordExpired = 18487;
export const errorPasswordNeedsReset = 18488;
export const errorLoginFailed = 18456;
export const errorFirewallRule = 40615;
export const errorSSLCertificateValidationFailed = -2146893019;
export const outputContentTypeRoot = "root";
export const outputContentTypeMessages = "messages";
export const outputContentTypeResultsetMeta = "resultsetsMeta";
export const outputContentTypeColumns = "columns";
export const outputContentTypeRows = "rows";
export const outputContentTypeConfig = "config";
export const outputContentTypeSaveResults = "saveResults";
export const outputContentTypeOpenLink = "openLink";
export const outputContentTypeCopy = "copyResults";
export const outputContentTypeEditorSelection = "setEditorSelection";
export const outputContentTypeShowError = "showError";
export const outputContentTypeShowWarning = "showWarning";
export const outputServiceLocalhost = "http://localhost:";
export const localhost = "localhost";
export const localhostIP = "127.0.0.1";
export const defaultContainerName = "sql_server_container";
export const msgContentProviderSqlOutputHtml = "dist/html/sqlOutput.ejs";
export const contentProviderMinFile = "dist/js/app.min.js";
export const untitledSaveTimeThreshold = 50.0;
export const renamedOpenTimeThreshold = 10.0;
export const timeToWaitForLanguageModeChange = 10000.0;
export const macOpenSslHelpLink =
    "https://github.com/Microsoft/vscode-mssql/wiki/OpenSSL-Configuration";
export const gettingStartedGuideLink = "https://aka.ms/mssql-getting-started";
export const changelogLink = "https://aka.ms/vscode-mssql-changes";
export const encryptionBlogLink = "https://aka.ms/vscodemssql-connection";
export const integratedAuthHelpLink = "https://aka.ms/vscode-mssql-integratedauth";
export const sqlToolsServiceCrashLink =
    "https://github.com/Microsoft/vscode-mssql/wiki/SqlToolsService-Known-Issues";
export const azureAccountExtensionId = "ms-vscode.azure-account";
export const databaseString = "Database";
export const localizedTexts = "localizedTexts";
export const ipAddressRegex =
    /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/;
/**
 * Azure Firewall rule name convention is specified here:
 * https://azure.github.io/PSRule.Rules.Azure/en/rules/Azure.Firewall.Name/
 * When naming Azure resources, resource names must meet service requirements. The requirements for Firewall names are:
 * - Between 1 and 80 characters long.
 * - Alphanumerics, underscores, periods, and hyphens.
 * - Start with alphanumeric.
 * - End alphanumeric or underscore.
 * - Firewall names must be unique within a resource group (we can't do string validation for this, so this is ignored)
 */
export const ruleNameRegex = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,78}[a-zA-Z0-9_]?$/;
export const configAzureAccount = "azureAccount";
export const azureAccountProviderCredentials = "azureAccountProviderCredentials";
export const msalCacheFileName = "accessTokenCache";
export const copilotConnectToolName = "mssql_connect";
export const copilotDisconnectToolName = "mssql_disconnect";
export const copilotListServersToolName = "mssql_list_servers";
export const copilotListDatabasesToolName = "mssql_list_databases";
export const copilotListTablesToolName = "mssql_list_tables";
export const copilotListSchemasToolName = "mssql_list_schemas";
export const copilotListViewsToolName = "mssql_list_views";
export const copilotListFunctionsToolName = "mssql_list_functions";
export const copilotRunQueryToolName = "mssql_run_query";
export const copilotChangeDatabaseToolName = "mssql_change_database";
export const copilotShowSchemaToolName = "mssql_show_schema";
export const copilotGetConnectionDetailsToolName = "mssql_get_connection_details";

// Configuration Constants
export const copyIncludeHeaders = "copyIncludeHeaders";
export const configLogDebugInfo = "logDebugInfo";
export const configMyConnections = "connections";
export const configSaveAsCsv = "saveAsCsv";
export const configSaveAsJson = "saveAsJson";
export const configSaveAsExcel = "saveAsExcel";
export const configRecentConnections = "recentConnections";
export const configMaxRecentConnections = "maxRecentConnections";
export const configCopyRemoveNewLine = "copyRemoveNewLine";
export const configSplitPaneSelection = "splitPaneSelection";
export const configShowBatchTime = "showBatchTime";
export enum extConfigResultKeys {
    Shortcuts = "shortcuts",
    MessagesDefaultOpen = "messagesDefaultOpen",
    ResultsFontSize = "resultsFontSize",
    ResultsFontFamily = "resultsFontFamily",
}
export const sqlToolsServiceInstallDirConfigKey = "installDir";
export const sqlToolsServiceExecutableFilesConfigKey = "executableFiles";
export const sqlToolsServiceVersionConfigKey = "version";
export const sqlToolsServiceDownloadUrlConfigKey = "downloadUrl";
export const extConfigResultFontFamily = "resultsFontFamily";
export const configPersistQueryResultTabs = "persistQueryResultTabs";
export const configQueryHistoryLimit = "queryHistoryLimit";
export const configEnableQueryHistoryCapture = "enableQueryHistoryCapture";
export const configEnableQueryHistoryFeature = "enableQueryHistoryFeature";
export const configEnableExperimentalFeatures = "mssql.enableExperimentalFeatures";
export const configEnableRichExperiences = "mssql.enableRichExperiences";
export const configEnableRichExperiencesDoNotShowPrompt =
    "mssql.enableRichExperiencesDoNotShowPrompt";
export const richFeaturesLearnMoreLink = "https://aka.ms/mssql-rich-features";
export const configOpenQueryResultsInTabByDefault = "mssql.openQueryResultsInTabByDefault";
export const configUseLegacyConnectionExperience = "mssql.useLegacyConnectionExperience";
export const configOpenQueryResultsInTabByDefaultDoNotShowPrompt =
    "mssql.openQueryResultsInTabByDefaultDoNotShowPrompt";
export const configAutoColumnSizing = "resultsGrid.autoSizeColumns";
export const configInMemoryDataProcessingThreshold = "resultsGrid.inMemoryDataProcessingThreshold";
export const configAutoDisableNonTSqlLanguageService = "mssql.autoDisableNonTSqlLanguageService";
export const copilotDebugLogging = "mssql.copilotDebugLogging";
export const configSelectedAzureSubscriptions = "mssql.selectedAzureSubscriptions";
export const configShowActiveConnectionAsCodeLensSuggestion =
    "mssql.query.showActiveConnectionAsCodeLensSuggestion";
export const configStatusBarConnectionInfoMaxLength = "statusBar.connectionInfoMaxLength";
export const configStatusBarEnableConnectionColor = "mssql.statusBar.enableConnectionColor";
export const configSchemaDesignerEnableExpandCollapseButtons =
    "mssql.schemaDesigner.enableExpandCollapseButtons";
export const configSavePasswordsUntilRestart =
    "mssql.connectionManagement.rememberPasswordsUntilRestart";

// ToolsService Constants
export const serviceInstallingTo = "Installing SQL tools service to";
export const serviceInstalling = "Installing";
export const serviceDownloading = "Downloading";
export const serviceInstalled = "Sql Tools Service installed";
export const serviceInstallationFailed = "Failed to install Sql Tools Service";
export const sqlToolsServiceCrashMessage = "SQL Tools Service component could not start.";
export const sqlToolsServiceCrashButton = "View Known Issues";
export const serviceInitializingOutputChannelName = "SqlToolsService Initialization";
export const serviceInitializing = "Initializing SQL tools service for the mssql extension.";
export const commandsNotAvailableWhileInstallingTheService =
    "Note: mssql commands will be available after installing the service.";
export const unsupportedPlatformErrorMessage = "The platform is not supported";
export const serviceLoadingFailed = "Failed to load Sql Tools Service";
export const invalidServiceFilePath = "Invalid file path for Sql Tools Service";
export const sqlToolsServiceName = "SQLToolsService";
export const resourceServiceName = "AzureResourceProvider";
export const resourceProviderId = "azurePublicCloud";
export const sqlToolsServiceConfigKey = "service";
export const v1SqlToolsServiceConfigKey = "v1Service";
export const scriptSelectText = "SELECT TOP (1000) * FROM ";
export const tenantDisplayName = "Microsoft";
export const windowsResourceClientPath = "SqlToolsResourceProviderService.exe";
export const unixResourceClientPath = "SqlToolsResourceProviderService";
export const microsoftPrivacyStatementUrl = "https://go.microsoft.com/fwlink/?LinkId=521839";
export const sqlPlanLanguageId = "sqlplan";
export const showPlanXmlColumnName = "Microsoft SQL Server 2005 XML Showplan";
export enum Platform {
    Windows = "win32",
    Mac = "darwin",
    Linux = "linux",
}
export const isRichExperiencesEnabledDefault = true;
export const sa = "SA";
export const x64 = "x64";
export const windowsDockerDesktopExecutable = "Docker Desktop.exe";
export const docker = "docker";
export const dockerDeploymentLoggerChannelName = "Docker Deployment";
