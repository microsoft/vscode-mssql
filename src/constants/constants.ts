/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from 'vscode-nls';
const localize = nls.loadMessageBundle();

// Collection of Non-localizable Constants
export const languageId = 'sql';
export const extensionName = 'mssql';
export const extensionConfigSectionName = 'mssql';
export const mssqlProviderName = 'MSSQL';
export const noneProviderName = 'None';
export const objectExplorerId = 'objectExplorer';
export const queryHistory = 'queryHistory';
export const connectionApplicationName = 'vscode-mssql';
export const outputChannelName = 'MSSQL';
export const connectionConfigFilename = 'settings.json';
export const connectionsArrayName = 'connections';
export const disconnectedServerLabel = 'disconnectedServer';
export const serverLabel = 'Server';
export const folderLabel = 'Folder';
export const cmdRunQuery = 'mssql.runQuery';
export const cmdRunCurrentStatement = 'mssql.runCurrentStatement';
export const cmdCancelQuery = 'mssql.cancelQuery';
export const cmdConnect = 'mssql.connect';
export const cmdDisconnect = 'mssql.disconnect';
export const cmdChooseDatabase = 'mssql.chooseDatabase';
export const cmdChooseLanguageFlavor = 'mssql.chooseLanguageFlavor';
export const cmdShowReleaseNotes = 'mssql.showReleaseNotes';
export const cmdShowGettingStarted = 'mssql.showGettingStarted';
export const cmdRefreshQueryHistory = 'mssql.refreshQueryHistory';
export const cmdClearAllQueryHistory = 'mssql.clearAllQueryHistory';
export const cmdDeleteQueryHistory = 'mssql.deleteQueryHistory';
export const cmdOpenQueryHistory = 'mssql.openQueryHistory';
export const cmdRunQueryHistory = 'mssql.runQueryHistory';
export const cmdStartQueryHistory = 'mssql.startQueryHistoryCapture';
export const cmdPauseQueryHistory = 'mssql.pauseQueryHistoryCapture';
export const cmdCommandPaletteQueryHistory = 'mssql.commandPaletteQueryHistory';
export const cmdNewQuery = 'mssql.newQuery';
export const cmdManageConnectionProfiles = 'mssql.manageProfiles';
export const cmdRebuildIntelliSenseCache = 'mssql.rebuildIntelliSenseCache';
export const cmdAddObjectExplorer = 'mssql.addObjectExplorer';
export const cmdObjectExplorerNewQuery = 'mssql.objectExplorerNewQuery';
export const cmdRemoveObjectExplorerNode = 'mssql.removeObjectExplorerNode';
export const cmdRefreshObjectExplorerNode = 'mssql.refreshObjectExplorerNode';
export const cmdDisconnectObjectExplorerNode = 'mssql.disconnectObjectExplorerNode';
export const cmdObjectExplorerNodeSignIn = 'mssql.objectExplorerNodeSignIn';
export const cmdConnectObjectExplorerNode = 'mssql.connectObjectExplorerNode';
export const cmdOpenObjectExplorerCommand = 'workbench.view.extension.objectExplorer';
export const cmdScriptSelect = 'mssql.scriptSelect';
export const cmdScriptCreate = 'mssql.scriptCreate';
export const cmdScriptDelete = 'mssql.scriptDelete';
export const cmdScriptExecute = 'mssql.scriptExecute';
export const cmdScriptAlter = 'mssql.scriptAlter';
export const cmdToggleSqlCmd = 'mssql.toggleSqlCmd';
export const cmdCopyObjectName = 'mssql.copyObjectName';
export const cmdOpenExtension = 'extension.open';
export const cmdLoadCompletionExtension = 'mssql.loadCompletionExtension';
export const cmdAzureSignIn = 'azure-account.login';
export const cmdAzureSignInWithDeviceCode = 'azure-account.loginWithDeviceCode';
export const cmdAzureSignInToCloud = 'azure-account.loginToCloud';
export const cmdAadRemoveAccount = 'mssql.removeAadAccount';
export const cmdCreateAzureFunction = 'mssql.createAzureFunction';
export const sqlDbPrefix = '.database.windows.net';
export const defaultConnectionTimeout = 15;
export const azureSqlDbConnectionTimeout = 30;
export const azureDatabase = 'Azure';
export const azureMfa = 'AzureMFA';
export const defaultPortNumber = 1433;
export const sqlAuthentication = 'SqlLogin';
export const defaultDatabase = 'master';
export const errorPasswordExpired = 18487;
export const errorPasswordNeedsReset = 18488;
export const errorLoginFailed = 18456;
export const errorFirewallRule = 40615;
export const maxDisplayedStatusTextLength = 50;
export const outputContentTypeRoot = 'root';
export const outputContentTypeMessages = 'messages';
export const outputContentTypeResultsetMeta = 'resultsetsMeta';
export const outputContentTypeColumns = 'columns';
export const outputContentTypeRows = 'rows';
export const outputContentTypeConfig = 'config';
export const outputContentTypeSaveResults = 'saveResults';
export const outputContentTypeOpenLink = 'openLink';
export const outputContentTypeCopy = 'copyResults';
export const outputContentTypeEditorSelection = 'setEditorSelection';
export const outputContentTypeShowError = 'showError';
export const outputContentTypeShowWarning = 'showWarning';
export const outputServiceLocalhost = 'http://localhost:';
export const msgContentProviderSqlOutputHtml = 'dist/html/sqlOutput.ejs';
export const contentProviderMinFile = 'dist/js/app.min.js';
export const serviceCompatibleVersion = '1.0.0';
export const untitledSaveTimeThreshold = 10.0;
export const renamedOpenTimeThreshold = 10.0;
export const timeToWaitForLanguageModeChange = 10000.0;
export const macOpenSslHelpLink = 'https://github.com/Microsoft/vscode-mssql/wiki/OpenSSL-Configuration';
export const gettingStartedGuideLink = 'https://aka.ms/mssql-getting-started';
export const changelogLink = 'https://aka.ms/vscode-mssql-changes';
export const integratedAuthHelpLink = 'https://aka.ms/vscode-mssql-integratedauth';
export const sqlToolsServiceCrashLink = 'https://github.com/Microsoft/vscode-mssql/wiki/SqlToolsService-Known-Issues';
export const azureAccountExtensionId = 'ms-vscode.azure-account';
export const databaseString = 'Database';
export const localizedTexts = 'localizedTexts';
export const ipAddressRegex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/;
export const configAzureAccount = 'azureAccount';

// Configuration Constants
export const copyIncludeHeaders = 'copyIncludeHeaders';
export const configLogDebugInfo = 'logDebugInfo';
export const configMyConnections = 'connections';
export const configSaveAsCsv = 'saveAsCsv';
export const configSaveAsJson = 'saveAsJson';
export const configSaveAsExcel = 'saveAsExcel';
export const configRecentConnections = 'recentConnections';
export const configMaxRecentConnections = 'maxRecentConnections';
export const configCopyRemoveNewLine = 'copyRemoveNewLine';
export const configSplitPaneSelection = 'splitPaneSelection';
export const configShowBatchTime = 'showBatchTime';
export const extConfigResultKeys = ['shortcuts', 'messagesDefaultOpen', 'resultsFontSize'];
export const sqlToolsServiceInstallDirConfigKey = 'installDir';
export const sqlToolsServiceExecutableFilesConfigKey = 'executableFiles';
export const sqlToolsServiceVersionConfigKey = 'version';
export const sqlToolsServiceDownloadUrlConfigKey = 'downloadUrl';
export const extConfigResultFontFamily = 'resultsFontFamily';
export const configApplyLocalization = 'applyLocalization';
export const configPersistQueryResultTabs = 'persistQueryResultTabs';
export const configQueryHistoryLimit = 'queryHistoryLimit';
export const configEnableQueryHistoryCapture = 'enableQueryHistoryCapture';
export const configEnableQueryHistoryFeature = 'enableQueryHistoryFeature';

// ToolsService Constants
export const serviceInstallingTo = 'Installing SQL tools service to';
export const serviceInstalling = 'Installing';
export const serviceDownloading = 'Downloading';
export const serviceInstalled = 'Sql Tools Service installed';
export const serviceInstallationFailed = 'Failed to install Sql Tools Service';
export const sqlToolsServiceCrashMessage = 'SQL Tools Service component could not start.';
export const sqlToolsServiceCrashButton = 'View Known Issues';
export const serviceInitializingOutputChannelName = 'SqlToolsService Initialization';
export const serviceInitializing = 'Initializing SQL tools service for the mssql extension.';
export const commandsNotAvailableWhileInstallingTheService = 'Note: mssql commands will be available after installing the service.';
export const unsupportedPlatformErrorMessage = 'The platform is not supported';
export const serviceLoadingFailed = 'Failed to load Sql Tools Service';
export const invalidServiceFilePath = 'Invalid file path for Sql Tools Service';
export const sqlToolsServiceName = 'SQLToolsService';
export const resourceServiceName = 'AzureResourceProvider';
export const resourceProviderId = 'azurePublicCloud';
export const serviceNotCompatibleError = 'Client is not compatible with the service layer';
export const sqlToolsServiceConfigKey = 'service';
export const v1SqlToolsServiceConfigKey = 'v1Service';
export const scriptSelectText = 'SELECT TOP (1000) * FROM ';
export const tenantDisplayName = 'Microsoft';
export const firewallErrorMessage = 'To enable access, use the Windows Azure Management Portal or run sp_set_firewall_rule on the master database to create a firewall rule for this IP address or address range.';
export const windowsResourceClientPath = 'SqlToolsResourceProviderService.exe';
export const unixResourceClientPath = 'SqlToolsResourceProviderService';

// Azure Functions
export const azureFunctionsExtensionName = 'ms-azuretools.vscode-azurefunctions';
export const sqlConnectionString = 'SqlConnectionString';
export const linkToAzureFunctionExtension = 'https://docs.microsoft.com/azure/azure-functions/functions-develop-vs-code';
export const defaultSqlBindingTextLines =
	[
		'log.LogInformation(\"C# HTTP trigger function processed a request.\");',
		'string name = req.Query[\"name\"];',
		'string requestBody = await new StreamReader(req.Body).ReadToEndAsync();',
		'dynamic data = JsonConvert.DeserializeObject(requestBody);',
		'name = name ?? data?.name;',
		'string responseMessage = string.IsNullOrEmpty(name) ? \"This HTTP triggered function executed successfully. Pass a name in the query string or in the request body for a personalized response.\" : $\"Hello, {name}. This HTTP triggered function executed successfully.\";'
	];
export const defaultBindingResult = 'return new OkObjectResult(responseMessage);';
export const sqlBindingResult = `return new OkObjectResult(result);`;
export const azureFunctionLocalSettingsFileName = 'local.settings.json';
export const sqlExtensionPackageName = 'Microsoft.Azure.WebJobs.Extensions.Sql';
export function failedToParse(errorMessage: string): string {
	return localize('failedToParse', 'Failed to parse "{0}": {1}.',
		azureFunctionLocalSettingsFileName, errorMessage);
}
export function settingAlreadyExists(settingName: string): string {
	return localize('SettingAlreadyExists', 'Local app setting \'{0}\' already exists. Overwrite?', settingName);
}
export const yesString = localize('yesString', 'Yes');
export const functionNameTitle = localize('functionNameTitle', 'Function Name');
export const selectProject = localize('selectProject', 'Select the Azure Function project for the SQL Binding');
export const timeoutError = localize('timeoutError', 'Timed out waiting for azure function file creation');
export const azureFunctionsExtensionNotFound = localize('azureFunctionsExtensionNotFound', 'The Azure Functions extension is required to create a new Azure Function with SQL binding but is not installed, install it now?');
export const installAzureFunction = localize('install', 'Install');
export const learnMore = localize('learnMore', 'Learn more');
export const doNotInstall = localize('doNotInstall', 'Do not install');
