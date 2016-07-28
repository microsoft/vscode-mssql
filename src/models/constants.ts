// constants
export const languageId = 'sql';
export const extensionName = 'vscode-mssql';
export const outputChannelName = 'MSSQL';

export const cmdRunQuery = 'extension.runQuery';
export const cmdConnect = 'extension.connect';
export const cmdDisconnect = 'extension.disconnect';
export const cmdRegisterConnection = 'extension.registerconnection';
export const cmdUnregisterConnection = 'extension.unregisterconnection';

export const sqlDbPrefix = '.database.windows.net';
export const defaultConnectionTimeout = 15000;
export const defaultRequestTimeout = 15000;
export const azureSqlDbConnectionTimeout = 30000;
export const azureSqlDbRequestTimeout = 30000;
export const azureDatabase = 'Azure';

export const outputContentTypeRoot = 'root';
export const outputContentTypeMessages = 'messages';
export const outputContentTypeResultsetMeta = 'resultsetsMeta';
export const outputContentTypeColumns = 'columns';
export const outputContentTypeRows = 'rows';
export const outputServiceLocalhost = 'http://localhost:';
export const msgContentProviderSqlOutputHtml = 'sqlOutput.ejs';

export const configLogDebugInfo = 'logDebugInfo';
export const configMyConnections = 'connections';

// localizable strings
export const configMyConnectionsNoServerName = 'Missing server name in user preferences connection: ';

export const msgLocalWebserviceStaticContent = 'LocalWebService: added static html content path: ';
export const msgLocalWebserviceStarted = 'LocalWebService listening on port ';
export const msgRunQueryAllBatchesExecuted = 'runQuery: all batches executed';
export const msgRunQueryError = 'runQuery: error: ';
export const msgRunQueryExecutingBatch = 'runQuery: executeBatch called with SQL: ';
export const msgRunQueryAddBatchResultsets = 'runQuery: adding resultsets for batch: ';
export const msgRunQueryAddBatchError = 'runQuery: adding error message for batch: ';
export const msgRunQueryConnectionActive = 'runQuery: active connection is connected, using it to run query';
export const msgRunQueryConnectionDisconnected = 'runQuery: active connection is disconnected, reconnecting';
export const msgRunQueryNoConnection = 'runQuery: no active connection - prompting for user';

export const msgContentProviderOnContentUpdated = 'Content provider: onContentUpdated called';
export const msgContentProviderOnRootEndpoint = 'LocalWebService: Root end-point called';
export const msgContentProviderOnResultsEndpoint = 'LocalWebService: ResultsetsMeta endpoint called';
export const msgContentProviderOnMessagesEndpoint = 'LocalWebService: Messages end-point called';
export const msgContentProviderOnColumnsEndpoint = 'LocalWebService:  Columns end-point called for index = ';
export const msgContentProviderOnRowsEndpoint = 'LocalWebService: Rows end-point called for index = ';
export const msgContentProviderOnClear = 'Content provider: clear called';
export const msgContentProviderOnUpdateContent = 'Content provider: updateContent called';
export const msgContentProviderProvideContent = 'Content provider: provideTextDocumentContent called: ';

export const extensionActivated = 'activated.';
export const extensionDeactivated = 'de-activated.';
export const msgOpenSqlFile = `To use this command, Open a .sql file -or-
                                Change editor language to "SQL" -or-
                                Select some T-SQL text in the active SQL editor.`;

export const recentConnectionsPlaceholder = 'Choose a connection from the list below';
export const msgNoConnectionsInSettings = 'To use this command, add connection information to VS Code User or Workspace settings.';
export const labelOpenGlobalSettings = 'Open Global Settings';
export const labelOpenWorkspaceSettings = 'Open Workspace Settings';
export const RegisterNewConnectionLabel = 'Register New Connection';

export const serverPrompt = 'Server name';
export const serverPlaceholder = 'hostname\\instance or <server>.database.windows.net';
export const databasePrompt = 'Database name';
export const databasePlaceholder = 'optional database to connect to (default depends on server configuration, typically "master")';
export const usernamePrompt = 'Username';
export const usernamePlaceholder = 'username (SQL Authentication)';
export const passwordPrompt = 'Password';
export const passwordPlaceholder = 'Password (SQL Authentication)';

export const msgIsRequired = ' is required.';
export const msgRetry = 'Retry';
export const msgError = 'Error: ';

export const notConnectedLabel = 'Not connected';
export const notConnectedTooltip = 'Click to connect to a database';
export const connectingLabel = 'Connecting';
export const connectingTooltip = 'Connecting to: ';
export const connectedLabel = 'Connected.';
export const connectErrorLabel = 'Connection error!';
export const connectErrorTooltip = 'Error connecting to: ';
export const connectErrorCode = 'Errorcode: ';
export const connectErrorMessage = 'ErrorMessage: ';
export const executeQueryLabel = 'Executing query ';
export const executeQueryErrorLabel = 'Query completed with errors';
export const executeQuerySuccessLabel = 'Query executed successfully';
export const executeQueryRowsAffected = ' row(s) affected';
export const executeQueryCommandCompleted = 'Command(s) completed successfully.';
