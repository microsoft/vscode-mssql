/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Collection of Non-localizable Constants
export const languageId = 'sql';
export const extensionName = 'mssql';
export const extensionConfigSectionName = 'mssql';
export const mssqlProviderName = 'MSSQL';
export const noneProviderName = 'None';
export const connectionApplicationName = 'vscode-mssql';
export const outputChannelName = 'MSSQL';
export const connectionConfigFilename = 'settings.json';
export const connectionsArrayName = 'connections';
export const cmdRunQuery = 'extension.runQuery';
export const cmdRunCurrentStatement = 'extension.runCurrentStatement';
export const cmdCancelQuery = 'extension.cancelQuery';
export const cmdConnect = 'extension.connect';
export const cmdDisconnect = 'extension.disconnect';
export const cmdChooseDatabase = 'extension.chooseDatabase';
export const cmdChooseLanguageFlavor = 'extension.chooseLanguageFlavor';
export const cmdShowReleaseNotes = 'extension.showReleaseNotes';
export const cmdShowGettingStarted = 'extension.showGettingStarted';
export const cmdNewQuery = 'extension.newQuery';
export const cmdManageConnectionProfiles = 'extension.manageProfiles';
export const cmdRebuildIntelliSenseCache = 'extension.rebuildIntelliSenseCache';
export const cmdAddObjectExplorer = 'extension.addObjectExplorer';
export const cmdObjectExplorerNewQuery = 'extension.objectExplorerNewQuery';
export const cmdRemoveObjectExplorerNode = 'extension.removeObjectExplorerNode';
export const cmdRefreshObjectExplorerNode = 'extension.refreshObjectExplorerNode';
export const cmdOpenObjectExplorerCommand = 'workbench.view.extension.objectExplorer';
export const cmdScriptSelect = 'extension.scriptSelect';
export const cmdToggleSqlCmd = 'extension.toggleSqlCmd';
export const cmdLoadCompletionExtension = 'mssql.loadCompletionExtension';
export const sqlDbPrefix = '.database.windows.net';
export const defaultConnectionTimeout = 15;
export const azureSqlDbConnectionTimeout = 30;
export const azureDatabase = 'Azure';
export const defaultPortNumber = 1433;
export const sqlAuthentication = 'SqlLogin';
export const defaultDatabase = 'master';
export const errorPasswordExpired = 18487;
export const errorPasswordNeedsReset = 18488;
export const errorLoginFailed = 18456;
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
export const changelogLink = 'https://aka.ms/vscode-mssql-changelog';
export const integratedAuthHelpLink = 'https://aka.ms/vscode-mssql-integratedauth';
export const sqlToolsServiceCrashLink = 'https://github.com/Microsoft/vscode-mssql/wiki/SqlToolsService-Known-Issues';
export const databaseString = 'Database';

export const localizedTexts = 'localizedTexts';

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
export const extConfigResultKeys = ['shortcuts', 'messagesDefaultOpen'];
export const sqlToolsServiceInstallDirConfigKey = 'installDir';
export const sqlToolsServiceExecutableFilesConfigKey = 'executableFiles';
export const sqlToolsServiceVersionConfigKey = 'version';
export const sqlToolsServiceDownloadUrlConfigKey = 'downloadUrl';
export const extConfigResultFontFamily = 'resultsFontFamily';
export const extConfigResultFontSize = 'resultsFontSize';
export const configApplyLocalization = 'applyLocalization';
export const configPersistQueryResultTabs = 'persistQueryResultTabs';

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
export const serviceNotCompatibleError = 'Client is not compatible with the service layer';
export const sqlToolsServiceConfigKey = 'service';
export const v1SqlToolsServiceConfigKey = 'v1Service';
export const scriptSelectText = 'SELECT TOP (1000) * FROM ';
export const useDatabaseText = 'USE ';
