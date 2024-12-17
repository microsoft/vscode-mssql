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
export const noneProviderName = "None";
export const objectExplorerId = "objectExplorer";
export const queryHistory = "queryHistory";
export const connectionApplicationName = "vscode-mssql";
export const outputChannelName = "MSSQL";
export const connectionConfigFilename = "settings.json";
export const connectionsArrayName = "connections";
export const disconnectedServerLabel = "disconnectedServer";
export const serverLabel = "Server";
export const folderLabel = "Folder";
export const cmdRunQuery = "mssql.runQuery";
export const cmdRunCurrentStatement = "mssql.runCurrentStatement";
export const cmdCancelQuery = "mssql.cancelQuery";
export const cmdrevealQueryResultPanel = "mssql.revealQueryResultPanel";
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
export const cmdManageConnectionProfiles = "mssql.manageProfiles";
export const cmdClearPooledConnections = "mssql.clearPooledConnections";
export const cmdRebuildIntelliSenseCache = "mssql.rebuildIntelliSenseCache";
export const cmdAddObjectExplorer = "mssql.addObjectExplorer";
export const cmdAddObjectExplorerPreview = "mssql.addObjectExplorerPreview";
export const cmdObjectExplorerNewQuery = "mssql.objectExplorerNewQuery";
export const cmdRemoveObjectExplorerNode = "mssql.removeObjectExplorerNode";
export const cmdRefreshObjectExplorerNode = "mssql.refreshObjectExplorerNode";
export const cmdDisconnectObjectExplorerNode =
    "mssql.disconnectObjectExplorerNode";
export const cmdObjectExplorerNodeSignIn = "mssql.objectExplorerNodeSignIn";
export const cmdConnectObjectExplorerNode = "mssql.connectObjectExplorerNode";
export const cmdConnectObjectExplorerProfile =
    "mssql.connectObjectExplorerProfile";
export const cmdOpenObjectExplorerCommand =
    "workbench.view.extension.objectExplorer";
export const cmdObjectExplorerGroupBySchemaFlagName =
    "mssql.objectExplorer.groupBySchema";
export const cmdObjectExplorerEnableGroupBySchemaCommand =
    "mssql.objectExplorer.enableGroupBySchema";
export const cmdObjectExplorerDisableGroupBySchemaCommand =
    "mssql.objectExplorer.disableGroupBySchema";
export const cmdScriptSelect = "mssql.scriptSelect";
export const cmdScriptCreate = "mssql.scriptCreate";
export const cmdScriptDelete = "mssql.scriptDelete";
export const cmdScriptExecute = "mssql.scriptExecute";
export const cmdScriptAlter = "mssql.scriptAlter";
export const cmdEditData = "mssql.editData";
export const cmdToggleSqlCmd = "mssql.toggleSqlCmd";
export const cmdCopyObjectName = "mssql.copyObjectName";
export const cmdFilterNode = "mssql.filterNode";
export const cmdFilterNodeWithExistingFilters =
    "mssql.filterNodeWithExistingFilters";
export const cmdClearFilters = "mssql.clearFilters";
export const cmdOpenExtension = "extension.open";
export const cmdLoadCompletionExtension = "mssql.loadCompletionExtension";
export const cmdAzureSignIn = "azure-account.login";
export const cmdAzureSignInWithDeviceCode = "azure-account.loginWithDeviceCode";
export const cmdAzureSignInToCloud = "azure-account.loginToCloud";
export const cmdAadRemoveAccount = "mssql.removeAadAccount";
export const cmdAadAddAccount = "mssql.addAadAccount";
export const cmdClearAzureTokenCache = "mssql.clearAzureAccountTokenCache";
export const cmdShowExecutionPlanInResults = "mssql.showExecutionPlanInResults";
export const cmdEnableActualPlan = "mssql.enableActualPlan";
export const cmdDisableActualPlan = "mssql.disableActualPlan";
export const cmdNewTable = "mssql.newTable";
export const cmdEditTable = "mssql.editTable";
export const cmdEditConnection = "mssql.editConnection";
export const cmdLaunchUserFeedback = "mssql.userFeedback";
export const piiLogging = "piiLogging";
export const mssqlPiiLogging = "mssql.piiLogging";
export const enableSqlAuthenticationProvider =
    "mssql.enableSqlAuthenticationProvider";
export const enableConnectionPooling = "mssql.enableConnectionPooling";
export const sqlDbPrefix = ".database.windows.net";
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
export const maxDisplayedStatusTextLength = 50;
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
export const msgContentProviderSqlOutputHtml = "dist/html/sqlOutput.ejs";
export const contentProviderMinFile = "dist/js/app.min.js";
export const untitledSaveTimeThreshold = 10.0;
export const renamedOpenTimeThreshold = 10.0;
export const timeToWaitForLanguageModeChange = 10000.0;
export const macOpenSslHelpLink =
    "https://github.com/Microsoft/vscode-mssql/wiki/OpenSSL-Configuration";
export const gettingStartedGuideLink = "https://aka.ms/mssql-getting-started";
export const changelogLink = "https://aka.ms/vscode-mssql-changes";
export const encryptionBlogLink = "https://aka.ms/vscodemssql-connection";
export const integratedAuthHelpLink =
    "https://aka.ms/vscode-mssql-integratedauth";
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
export const azureAccountProviderCredentials =
    "azureAccountProviderCredentials";
export const msalCacheFileName = "accessTokenCache";

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
export const extConfigResultKeys = [
    "shortcuts",
    "messagesDefaultOpen",
    "resultsFontSize",
    "resultsFontFamily",
];
export const sqlToolsServiceInstallDirConfigKey = "installDir";
export const sqlToolsServiceExecutableFilesConfigKey = "executableFiles";
export const sqlToolsServiceVersionConfigKey = "version";
export const sqlToolsServiceDownloadUrlConfigKey = "downloadUrl";
export const extConfigResultFontFamily = "resultsFontFamily";
export const configApplyLocalization = "applyLocalization";
export const configPersistQueryResultTabs = "persistQueryResultTabs";
export const configQueryHistoryLimit = "queryHistoryLimit";
export const configEnableQueryHistoryCapture = "enableQueryHistoryCapture";
export const configEnableQueryHistoryFeature = "enableQueryHistoryFeature";
export const configEnableExperimentalFeatures =
    "mssql.enableExperimentalFeatures";
export const configEnableRichExperiences = "mssql.enableRichExperiences";
export const configEnableRichExperiencesDoNotShowPrompt =
    "mssql.enableRichExperiencesDoNotShowPrompt";
export const richFeaturesLearnMoreLink = "https://aka.ms/mssql-rich-features";
export const configOpenQueryResultsInTabByDefault =
    "mssql.openQueryResultsInTabByDefault";
export const configEnableNewQueryResultFeature =
    "mssql.enableNewQueryResultFeature";
export const configOpenQueryResultsInTabByDefaultDoNotShowPrompt =
    "mssql.openQueryResultsInTabByDefaultDoNotShowPrompt";

// ToolsService Constants
export const serviceInstallingTo = "Installing SQL tools service to";
export const serviceInstalling = "Installing";
export const serviceDownloading = "Downloading";
export const serviceInstalled = "Sql Tools Service installed";
export const serviceInstallationFailed = "Failed to install Sql Tools Service";
export const sqlToolsServiceCrashMessage =
    "SQL Tools Service component could not start.";
export const sqlToolsServiceCrashButton = "View Known Issues";
export const serviceInitializingOutputChannelName =
    "SqlToolsService Initialization";
export const serviceInitializing =
    "Initializing SQL tools service for the mssql extension.";
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
export const microsoftPrivacyStatementUrl =
    "https://www.microsoft.com/en-us/privacy/privacystatement";
export const sqlPlanLanguageId = "sqlplan";
export const showPlanXmlColumnName = "Microsoft SQL Server 2005 XML Showplan";
export enum Platform {
    Windows = "win32",
    Mac = "darwin",
    Linux = "linux",
}
