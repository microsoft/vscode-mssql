// constants
export const languageId = 'sql';
export const extensionName = 'vscode-mssql';
export const outputChannelName = 'MSSQL';

export const connectionConfigFilename = 'settings.json';
export const connectionsArrayName = 'vscode-mssql.connections';

export const cmdRunQuery = 'extension.runQuery';
export const cmdCancelQuery = 'extension.cancelQuery';
export const cmdConnect = 'extension.connect';
export const cmdCancelConnect = 'extension.cancelConnect';
export const cmdDisconnect = 'extension.disconnect';
export const cmdCreateProfile = 'extension.createprofile';
export const cmdRemoveProfile = 'extension.removeprofile';
export const cmdChooseDatabase = 'extension.chooseDatabase';
export const cmdShowReleaseNotes = 'extension.showReleaseNotes';

export const sqlDbPrefix = '.database.windows.net';
export const defaultConnectionTimeout = 15;
export const azureSqlDbConnectionTimeout = 30;
export const azureDatabase = 'Azure';
export const defaultPortNumber = 1433;

export const errorPasswordExpired = 18487;
export const errorPasswordNeedsReset = 18488;

export const maxDisplayedStatusTextLength = 50;

export const outputContentTypeRoot = 'root';
export const outputContentTypeMessages = 'messages';
export const outputContentTypeResultsetMeta = 'resultsetsMeta';
export const outputContentTypeColumns = 'columns';
export const outputContentTypeRows = 'rows';
export const outputContentTypeSaveResults = 'saveResults';
export const outputContentTypeOpenLink = 'openLink';
export const outputContentTypeCopy = 'copyResults';
export const outputContentTypeEditorSelection = 'setEditorSelection';
export const outputServiceLocalhost = 'http://localhost:';
export const msgContentProviderSqlOutputHtml = 'sqlOutput.ejs';

export const configLogDebugInfo = 'logDebugInfo';
export const configMyConnections = 'connections';
export const configSaveAsCsv = 'saveAsCsv';
export const configSaveAsJson = 'saveAsJson';
export const configRecentConnections = 'recentConnections';
export const configMaxRecentConnections = 'maxRecentConnections';


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
export const msgRunQueryInProgress = 'A query is already executing for this editor session. Please cancel this query or wait for its completion.';

export const msgCancelQueryFailed = 'Failed to cancel query: {0}';

export const msgContentProviderOnContentUpdated = 'Content provider: onContentUpdated called';
export const msgContentProviderAssociationFailure = 'Content provider: Unable to associate status view for current file';
export const msgContentProviderOnRootEndpoint = 'LocalWebService: Root end-point called';
export const msgContentProviderOnResultsEndpoint = 'LocalWebService: ResultsetsMeta endpoint called';
export const msgContentProviderOnMessagesEndpoint = 'LocalWebService: Messages end-point called';
export const msgContentProviderOnColumnsEndpoint = 'LocalWebService:  Columns end-point called for index = ';
export const msgContentProviderOnRowsEndpoint = 'LocalWebService: Rows end-point called for index = ';
export const msgContentProviderOnClear = 'Content provider: clear called';
export const msgContentProviderOnUpdateContent = 'Content provider: updateContent called';
export const msgContentProviderProvideContent = 'Content provider: provideTextDocumentContent called: ';

export const msgChooseDatabaseNotConnected = 'Not connected. Please connect to a server first.';
export const msgChooseDatabasePlaceholder = 'Choose a database from the list below';

export const msgConnectionError = 'Error {0}: {1}';
export const msgConnectionError2 = 'Failed to connect: {0}';
export const msgConnectionErrorPasswordExpired = 'Error {0}: {1} Please login as a different user and change the password using ALTER LOGIN.';
export const connectionErrorChannelName = 'Connection Errors';

export const msgPromptCancelConnect = 'Cancel connecting?';

export const extensionActivated = 'activated.';
export const extensionDeactivated = 'de-activated.';
export const msgOpenSqlFile = 'To use this command, Open a .sql file -or- ' +
                                'Change editor language to "SQL" -or- ' +
                                'Select some T-SQL text in the active SQL editor.';

export const recentConnectionsPlaceholder = 'Choose a connection from the list below';
export const msgNoConnectionsInSettings = 'To use this command, add connection information to VS Code User or Workspace settings.';
export const labelOpenGlobalSettings = 'Open Global Settings';
export const labelOpenWorkspaceSettings = 'Open Workspace Settings';
export const CreateProfileLabel = 'Create Connection Profile';
export const RemoveProfileLabel = 'Remove Connection Profile';
export const SampleServerName = '{{put-server-name-here}}';

export const serverPrompt = 'Server name';
export const serverPlaceholder = 'hostname\\instance or <server>.database.windows.net';
export const databasePrompt = 'Database name';
export const databasePlaceholder = 'optional database to connect to (default depends on server configuration, typically "master")';
export const databaseDefaultValue = 'master';
export const authTypePrompt = 'Authentication Type';
export const authTypeIntegrated = 'Integrated';
export const authTypeSql = 'SQL Authentication';
export const authTypeAdUniversal = 'Active Directory Universal';
export const usernamePrompt = 'Username';
export const usernamePlaceholder = 'username (SQL Authentication)';
export const passwordPrompt = 'Password';
export const passwordPlaceholder = 'Password (SQL Authentication)';
export const msgSavePassword = 'Save Password? If \'No\', password will be required each time you connect';
export const profileNamePrompt = 'Profile Name';
export const profileNamePlaceholder = 'optional - enter a name for this profile';

export const filepathPrompt = 'File path';
export const filepathPlaceholder = 'Enter full path or simply file name';
export const filepathMessage = 'Enter full path or simply file name';
export const overwritePrompt = 'The file already exists. Would you like to overwrite?';
export const overwritePlaceholder = 'The file already exists';

export const msgSelectProfile = 'Select Connection Profile';
export const msgSelectProfileToRemove = 'Select profile to remove';

export const confirmRemoveProfilePrompt = 'Are you sure you want to remove this profile?';
export const msgNoProfilesSaved = 'No connection profiles are currently saved';
export const msgProfileRemoved = 'Profile removed successfully';
export const msgProfileCreated = 'Profile created and connected';

export const msgSelectionIsRequired = 'Selection is required.';
export const msgIsRequired = ' is required.';
export const msgRetry = 'Retry';
export const msgError = 'Error: ';

export const msgYes = 'Yes';
export const msgNo = 'No';

export const defaultDatabaseLabel = '<default>';
export const notConnectedLabel = 'Disconnected';
export const notConnectedTooltip = 'Click to connect to a database';
export const connectingLabel = 'Connecting';
export const connectingTooltip = 'Connecting to: ';
export const connectedLabel = 'Connected.';
export const connectErrorLabel = 'Connection error';
export const connectErrorTooltip = 'Error connecting to: ';
export const connectErrorCode = 'Errorcode: ';
export const connectErrorMessage = 'ErrorMessage: ';
export const executeQueryLabel = 'Executing query ';

export const serviceCompatibleVersion = '1.0.0';
export const serviceNotCompatibleError = 'Client is not compatiable with the service layer';
export const serviceInstalling = 'Installing Sql Tools Service';
export const serviceInstalled = 'Sql Tools Service installed';
export const serviceInstallationFailed = 'Failed to install Sql Tools Service';
export const serviceLoadingFailed = 'Failed to load Sql Tools Service';
export const invalidServiceFilePath = 'Invalid file path for Sql Tools Service';

export const untitledScheme = 'untitled';
export const untitledSaveTimeThreshold = 10.0;

export const msgChangeLanguageMode = 'To use this command, you must set the language to \"SQL\". Change language mode?';
export const timeToWaitForLanguageModeChange = 10000.0;

export const msgChangedDatabaseContext = 'Changed database context to \"{0}\" for document \"{1}\"';

export const msgPromptRetryCreateProfile = 'Error: Unable to connect using the profile information provided. Retry profile creation?';

export const msgConnecting = 'Connecting to server \"{0}\" on document \"{1}\".';
export const msgConnectedServerInfo = 'Connected to server \"{0}\" on document \"{1}\". Server information: {2}';
export const msgConnectionFailed = 'Error connecting to server \"{0}\". Details: {1}';
export const msgChangingDatabase = 'Changing database context to \"{0}\" on server \"{1}\" on document \"{2}\".';
export const msgChangedDatabase = 'Changed database context to \"{0}\" on server \"{1}\" on document \"{2}\".';
export const msgDisconnected = 'Disconnected on document \"{0}\"';

export const msgErrorReadingConfigFile = 'Error: Unable to load connection profiles from [{0}]. Check that the file is formatted correctly.';
export const msgErrorOpeningConfigFile = 'Error: Unable to open connection profile settings file.';


export const sqlToolsServiceConfigKey = 'service';
export const sqlToolsServiceInstallDirConfigKey = 'installDir';
export const sqlToolsServiceExecutableFilesConfigKey = 'executableFiles';
export const sqlToolsServiceVersionConfigKey = 'version';
export const sqlToolsServiceDownloadUrlConfigKey = 'downloadUrl';

export const titleResultsPane = 'SQL Query Results: {0}';

export const macOpenSslErrorMessage = `OpenSSL version >=1.0.1 is required for connecting.`;

