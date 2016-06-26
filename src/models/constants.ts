// constants
export const gLanguageId = "sql";
export const gExtensionName = "vscode-mssql";
export const gOutputChannelName = "MSSQL";

export const gCmdRunQuery = 'extension.runQuery';
export const gCmdConnect = 'extension.connect';
export const gCmdDisconnect = 'extension.disconnect';

export const gSqlDbPrefix = ".database.windows.net";
export const gDefaultConnectionTimeout = 15000;
export const gDefaultRequestTimeout = 15000;
export const gAzureSqlDbConnectionTimeout = 30000;
export const gAzureSqlDbRequestTimeout = 30000;
export const gAzureDatabase = "Azure";

export const gOutputContentTypeRoot = '/';
export const gOutputContentTypeMessages = "messages";
export const gOutputContentTypeResultsetMeta = 'resultsetsMeta';
export const gOutputContentTypeColumns = 'columns'
export const gOutputContentTypeRows = 'rows'
export const gOutputServiceLocalhost = "http://localhost:";
export const gMsgContentProviderSqlOutputHtml = 'sqlOutput.html';

export const gConfigLogDebugInfo = "logDebugInfo";
export const gConfigMyConnections = "connections";

// localizable strings
export const gConfigMyConnectionsNoServerName = "Missing server name in user preferences connection: ";

export const gMsgLocalWebserviceStaticContent = "LocalWebService: added static html content path: ";
export const gMsgLocalWebserviceStarted = 'LocalWebService listening on port ';
export const gMsgRunQueryAllBatchesExecuted = 'runQuery: all batches executed';
export const gMsgRunQueryError = 'runQuery: error: ';
export const gMsgRunQueryExecutingBatch = 'runQuery: executeBatch called with SQL: '
export const gMsgRunQueryAddBatchResultsets = 'runQuery: adding resultsets for batch: '
export const gMsgRunQueryAddBatchError = 'runQuery: adding error message for batch: '
export const gMsgRunQueryConnectionActive = 'runQuery: active connection is connected, using it to run query';
export const gMsgRunQueryConnectionDisconnected = 'runQuery: active connection is disconnected, reconnecting';
export const gMsgRunQueryNoConnection = 'runQuery: no active connection - prompting for user';

export const gMsgContentProviderOnContentUpdated = "Content provider: onContentUpdated called";
export const gMsgContentProviderOnRootEndpoint = 'LocalWebService: Root end-point called';
export const gMsgContentProviderOnResultsEndpoint = "LocalWebService: ResultsetsMeta endpoint called";
export const gMsgContentProviderOnMessagesEndpoint = 'LocalWebService: Messages end-point called';
export const gMsgContentProviderOnColumnsEndpoint = "LocalWebService:  Columns end-point called for index = ";
export const gMsgContentProviderOnRowsEndpoint = "LocalWebService: Rows end-point called for index = ";
export const gMsgContentProviderOnClear = "Content provider: clear called";
export const gMsgContentProviderOnUpdateContent = 'Content provider: updateContent called';
export const gMsgContentProviderProvideContent = 'Content provider: provideTextDocumentContent called: ';

export const gExtensionActivated = "activated.";
export const gExtensionDeactivated = "de-activated.";
export const gMsgOpenSqlFile = "To use this command, Open a .sql file -or- Change editor language to 'SQL' -or- Select some T-SQL text in the active SQL editor.";

export const gRecentConnectionsPlaceholder = "Choose a connection from the list below";
export const gMsgNoConnectionsInSettings = "To use this command, add connection information to VS Code User or Workspace settings.";
export const gLabelOpenGlobalSettings = "Open Global Settings";
export const gLabelOpenWorkspaceSettings = "Open Workspace Settings";

export const gServerPrompt = "Server name";
export const gServerPlaceholder = "hostname\\instance or <server>.database.windows.net";
export const gDatabasePrompt = "Database name";
export const gDatabasePlaceholder = "optional database to connect to (default depends on server configuration, typically 'master')";
export const gUsernamePrompt = "Username";
export const gUsernamePlaceholder = "username (SQL Authentication)";
export const gPasswordPrompt = "Password";
export const gPasswordPlaceholder = "Password (SQL Authentication)";

export const gMsgIsRequired = " is required.";
export const gMsgRetry = "Retry";
export const gMsgError = "Error: ";

export const gNotConnectedLabel = "Not connected";
export const gNotConnectedTooltip = "Click to connect to a database";
export const gConnectingLabel = "Connecting";
export const gConnectingTooltip = "Connecting to: ";
export const gConnectedLabel = "Connected.";
export const gConnectErrorLabel = "Connection error!";
export const gConnectErrorTooltip = "Error connecting to: ";
export const gConnectErrorCode = "Errorcode: ";
export const gConnectErrorMessage = "ErrorMessage: ";
export const gExecuteQueryLabel = "Executing query ";
export const gExecuteQueryErrorLabel = "Query completed with errors";
export const gExecuteQuerySuccessLabel = "Query executed successfully";
export const gExecuteQueryRowsAffected = " row(s) affected";
export const gExecuteQueryCommandCompleted = "Command(s) completed successfully.";