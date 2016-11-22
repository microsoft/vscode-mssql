// constants
export const languageId = 'sql';
export const extensionName = 'mssql';
export const extensionConfigSectionName = 'mssql';
export const connectionApplicationName = 'vscode-mssql';
export const outputChannelName = 'MSSQL';

export const connectionConfigFilename = 'settings.json';
export const connectionsArrayName = 'mssql.connections';

export const cmdRunQuery = 'extension.runQuery';
export const cmdCancelQuery = 'extension.cancelQuery';
export const cmdConnect = 'extension.connect';
export const cmdDisconnect = 'extension.disconnect';
export const cmdChooseDatabase = 'extension.chooseDatabase';
export const cmdShowReleaseNotes = 'extension.showReleaseNotes';
export const cmdManageConnectionProfiles = 'extension.manageProfiles';

export const sqlDbPrefix = '.database.windows.net';
export const defaultConnectionTimeout = 15;
export const azureSqlDbConnectionTimeout = 30;
export const azureDatabase = 'Azure';
export const defaultPortNumber = 1433;
export const sqlAuthentication = 'SqlLogin';
export const defaultDatabase = 'master';

export const errorPasswordExpired = 18487;
export const errorPasswordNeedsReset = 18488;

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

export const copyIncludeHeaders = 'copyIncludeHeaders';
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
export const msgStartedExecute = 'Started query execution for document "{0}"';
export const msgFinishedExecute = 'Finished query execution for document "{0}"';
export const msgRunQueryError = 'runQuery: error: ';
export const msgRunQueryExecutingBatch = 'runQuery: executeBatch called with SQL: ';
export const msgRunQueryAddBatchResultsets = 'runQuery: adding resultsets for batch: ';
export const msgRunQueryAddBatchError = 'runQuery: adding error message for batch: ';
export const msgRunQueryConnectionActive = 'runQuery: active connection is connected, using it to run query';
export const msgRunQueryConnectionDisconnected = 'runQuery: active connection is disconnected, reconnecting';
export const msgRunQueryNoConnection = 'runQuery: no active connection - prompting for user';
export const msgRunQueryInProgress = 'A query is already running for this editor session. Please cancel this query or wait for its completion.';

export const msgCancelQueryFailed = 'Canceling the query failed: {0}';
export const msgCancelQueryNotRunning = 'Cannot cancel query as no query is running.';
export const msgCancelQuerySuccess = 'Successfully canceled the query.';

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

export const msgChooseDatabaseNotConnected = 'No connection was found. Please connect to a server first.';
export const msgChooseDatabasePlaceholder = 'Choose a database from the list below';

export const msgConnectionError = 'Error {0}: {1}';
export const msgConnectionError2 = 'Failed to connect: {0}';
export const msgConnectionErrorPasswordExpired = 'Error {0}: {1} Please login as a different user and change the password using ALTER LOGIN.';
export const connectionErrorChannelName = 'Connection Errors';

export const msgPromptCancelConnect = 'Server connection in progress. Do you want to cancel?';
export const msgPromptClearRecentConnections = 'Confirm to clear recent connections list';

export const extensionActivated = 'activated.';
export const extensionDeactivated = 'de-activated.';
export const msgOpenSqlFile = 'To use this command, Open a .sql file -or- ' +
                                'Change editor language to "SQL" -or- ' +
                                'Select T-SQL text in the active SQL editor.';

export const recentConnectionsPlaceholder = 'Choose a connection profile from the list below';
export const msgNoConnectionsInSettings = 'To use this command, add connection profile to User Settings.';
export const labelOpenGlobalSettings = 'Open Global Settings';
export const labelOpenWorkspaceSettings = 'Open Workspace Settings';
export const CreateProfileFromConnectionsListLabel = 'Create Connection Profile';
export const CreateProfileLabel = 'Create';
export const ClearRecentlyUsedLabel = 'Clear Recent Connections List';
export const EditProfilesLabel = 'Edit';
export const RemoveProfileLabel = 'Remove';
export const ManageProfilesPrompt = 'Manage Connection Profiles';
export const SampleServerName = '{{put-server-name-here}}';

export const serverPrompt = 'Server name';
export const serverPlaceholder = 'hostname\\instance or <server>.database.windows.net';
export const databasePrompt = 'Database name';
export const databasePlaceholder = '[Optional] Database to connect (press Enter to connect to <default> database)';
export const databaseDefaultValue = 'master';
export const authTypePrompt = 'Authentication Type';
export const authTypeIntegrated = 'Integrated';
export const authTypeSql = 'SQL Login';
export const authTypeAdUniversal = 'Active Directory Universal';
export const usernamePrompt = 'User name';
export const usernamePlaceholder = 'User name (SQL Login)';
export const passwordPrompt = 'Password';
export const passwordPlaceholder = 'Password (SQL Login)';
export const msgSavePassword = 'Save Password? If \'No\', password will be required each time you connect';
export const profileNamePrompt = 'Profile Name';
export const profileNamePlaceholder = '[Optional] Enter a name for this profile';

export const filepathPrompt = 'File path';
export const filepathPlaceholder = 'File name';
export const filepathMessage = 'File name';
export const overwritePrompt = 'A file with this name already exists. Do you want to replace the existing file?';
export const overwritePlaceholder = 'A file with this name already exists';

export const msgSaveResultInProgress = 'A save request is already executing. Please wait for its completion.';
export const msgCannotOpenContent = 'Error occured opening content in editor.';
export const msgSaveStarted = 'Started saving results to ';
export const msgSaveFailed = 'Failed to save results. ';
export const msgSaveSucceeded = 'Successfully saved results to ';

export const msgSelectProfile = 'Select connection profile';
export const msgSelectProfileToRemove = 'Select profile to remove';

export const confirmRemoveProfilePrompt = 'Confirm to remove this profile.';
export const msgNoProfilesSaved = 'No connection profile to remove.';
export const msgProfileRemoved = 'Profile removed successfully';
export const msgProfileCreated = 'Profile created successfully';
export const msgProfileCreatedAndConnected = 'Profile created and connected';
export const msgClearedRecentConnections = 'Recent connections list cleared';

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
export const cancelingQueryLabel = 'Canceling query ';
export const updatingIntelliSenseLabel = 'Updating IntelliSense...';
export const unfoundResult = 'Data was disposed when text editor was closed; to view data please reexecute query.';

export const serviceCompatibleVersion = '1.0.0';
export const serviceNotCompatibleError = 'Client is not compatible with the service layer';
export const serviceInstalling = 'Installing Sql Tools Service';
export const serviceInstalled = 'Sql Tools Service installed';
export const serviceInstallationFailed = 'Failed to install Sql Tools Service';
export const serviceLoadingFailed = 'Failed to load Sql Tools Service';
export const invalidServiceFilePath = 'Invalid file path for Sql Tools Service';
export const extensionNotInitializedError = 'Unable to execute the command while the extension is initializing. Please try again later.';

export const untitledScheme = 'untitled';
export const untitledSaveTimeThreshold = 10.0;

export const msgChangeLanguageMode = 'To use this command, you must set the language to \"SQL\". Confirm to change language mode.';
export const timeToWaitForLanguageModeChange = 10000.0;

export const msgChangedDatabaseContext = 'Changed database context to \"{0}\" for document \"{1}\"';

export const msgPromptRetryCreateProfile = 'Error: Unable to connect using the connection information provided. Retry profile creation?';
export const retryLabel = 'Retry';

export const msgConnecting = 'Connecting to server \"{0}\" on document \"{1}\".';
export const msgConnectedServerInfo = 'Connected to server \"{0}\" on document \"{1}\". Server information: {2}';
export const msgConnectionFailed = 'Error connecting to server \"{0}\". Details: {1}';
export const msgChangingDatabase = 'Changing database context to \"{0}\" on server \"{1}\" on document \"{2}\".';
export const msgChangedDatabase = 'Changed database context to \"{0}\" on server \"{1}\" on document \"{2}\".';
export const msgDisconnected = 'Disconnected on document \"{0}\"';

export const msgErrorReadingConfigFile = 'Error: Unable to load connection profiles from [{0}]. Check if the file is formatted correctly.';
export const msgErrorOpeningConfigFile = 'Error: Unable to open connection profile settings file.';


export const sqlToolsServiceConfigKey = 'service';
export const sqlToolsServiceInstallDirConfigKey = 'installDir';
export const sqlToolsServiceExecutableFilesConfigKey = 'executableFiles';
export const sqlToolsServiceVersionConfigKey = 'version';
export const sqlToolsServiceDownloadUrlConfigKey = 'downloadUrl';

export const extConfigResultKeys = ['shortcuts', 'messagesDefaultOpen'];

export const titleResultsPane = 'Results: {0}';

export const macOpenSslErrorMessage = `OpenSSL version >=1.0.1 is required to connect.`;
export const macOpenSslHelpButton = 'Help';
export const macOpenSslHelpLink = 'https://github.com/Microsoft/vscode-mssql/wiki/OpenSSL-Configuration';

