/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";

// Warning: Only update these strings if you are sure you want to affect _all_ locations they're shared between.
export class Common {
    public static remindMeLater = l10n.t("Remind Me Later");
    public static dontShowAgain = l10n.t("Don't Show Again");
    public static learnMore = l10n.t("Learn More");
    public static delete = l10n.t("Delete");
    public static cancel = l10n.t("Cancel");
    public static areYouSure = l10n.t("Are you sure?");
    public static areYouSureYouWantTo = (action: string) =>
        l10n.t({
            message: "Are you sure you want to {0}?",
            args: [action],
            comment: ["{0} is the action being confirmed"],
        });
    public static accept = l10n.t("Accept");
    public static error = l10n.t("Error");
}

export let viewMore = l10n.t("View More");
export let releaseNotesPromptDescription = l10n.t(
    "View mssql for Visual Studio Code release notes?",
);
export function msgStartedExecute(documentName: string) {
    return l10n.t({
        message: 'Started query execution for document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export function msgFinishedExecute(documentName: string) {
    return l10n.t({
        message: 'Finished query execution for document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export let msgRunQueryInProgress = l10n.t(
    "A query is already running for this editor session. Please cancel this query or wait for its completion.",
);
export let runQueryBatchStartMessage = l10n.t("Started executing query at ");
export function runQueryBatchStartLine(lineNumber: number) {
    return l10n.t({
        message: "Line {0}",
        args: [lineNumber],
        comment: ["{0} is the line number"],
    });
}
export function msgCancelQueryFailed(error: string) {
    return l10n.t({
        message: "Canceling the query failed: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export let msgCancelQueryNotRunning = l10n.t("Cannot cancel query as no query is running.");
export let msgChooseDatabaseNotConnected = l10n.t(
    "No connection was found. Please connect to a server first.",
);
export let msgChooseDatabasePlaceholder = l10n.t("Choose a database from the list below");
export function msgConnectionError(errorNumber: number, errorMessage: string) {
    return l10n.t({
        message: "Error {0}: {1}",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
export function msgConnectionError2(errorMessage: string) {
    return l10n.t({
        message: "Failed to connect: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
}
export let serverNameMissing = l10n.t("Server name not set.");
export function msgConnectionErrorPasswordExpired(errorNumber: number, errorMessage: string) {
    return l10n.t({
        message:
            "Error {0}: {1} Please login as a different user and change the password using ALTER LOGIN.",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
export let msgPromptCancelConnect = l10n.t("Server connection in progress. Do you want to cancel?");
export let msgPromptClearRecentConnections = l10n.t("Confirm to clear recent connections list");
export let msgOpenSqlFile = l10n.t(
    'To use this command, Open a .sql file -or- Change editor language to "SQL" -or- Select T-SQL text in the active SQL editor.',
);
export let recentConnectionsPlaceholder = l10n.t("Choose a connection profile from the list below");
export let CreateProfileFromConnectionsListLabel = l10n.t("Create Connection Profile");
export let CreateProfileLabel = l10n.t("Create");
export let ClearRecentlyUsedLabel = l10n.t("Clear Recent Connections List");
export let EditProfilesLabel = l10n.t("Edit");
export let RemoveProfileLabel = l10n.t("Remove");
export let ManageProfilesPrompt = l10n.t("Manage Connection Profiles");
export let SampleServerName = l10n.t("{{put-server-name-here}}");
export let serverPrompt = l10n.t("Server name or ADO.NET connection string");
export let serverPlaceholder = l10n.t(
    "hostname\\instance or <server>.database.windows.net or ADO.NET connection string",
);
export let databasePrompt = l10n.t("Database name");
export let startIpAddressPrompt = l10n.t("Start IP Address");
export let endIpAddressPrompt = l10n.t("End IP Address");
export let firewallRuleNamePrompt = l10n.t("Firewall rule name");
export let databasePlaceholder = l10n.t(
    "[Optional] Database to connect (press Enter to connect to <default> database)",
);
export let authTypePrompt = l10n.t("Authentication Type");
export let authTypeName = l10n.t("authenticationType");
export let authTypeIntegrated = l10n.t("Integrated");
export let authTypeSql = l10n.t("SQL Login");
export let authTypeAzureActiveDirectory = l10n.t("Microsoft Entra Id - Universal w/ MFA Support");
export let azureAuthTypeCodeGrant = l10n.t("Azure Code Grant");
export let azureAuthTypeDeviceCode = l10n.t("Azure Device Code");
export let azureLogChannelName = l10n.t("MSSQL - Azure Auth Logs");
export let azureConsentDialogOpen = l10n.t("Open");
export let azureConsentDialogIgnore = l10n.t("Ignore Tenant");
export function azureConsentDialogBody(tenantName: string, tenantId: string, resource: string) {
    return l10n.t({
        message:
            "Your tenant '{0} ({1})' requires you to re-authenticate again to access {2} resources. Press Open to start the authentication process.",
        args: [tenantName, tenantId, resource],
        comment: ["{0} is the tenant name", "{1} is the tenant id", "{2} is the resource"],
    });
}
export function azureConsentDialogBodyAccount(resource: string) {
    return l10n.t({
        message:
            "Your account needs re-authentication to access {0} resources. Press Open to start the authentication process.",
        args: [resource],
        comment: ["{0} is the resource"],
    });
}
export let azureMicrosoftCorpAccount = l10n.t("Microsoft Corp");
export let azureMicrosoftAccount = l10n.t("Microsoft Entra Account");
export function azureNoMicrosoftResource(provider: string) {
    return l10n.t({
        message: "Provider '{0}' does not have a Microsoft resource endpoint defined.",
        args: [provider],
        comment: ["{0} is the provider"],
    });
}
export let unableToGetProxyAgentOptionsToGetTenants = l10n.t(
    "Unable to read proxy agent options to get tenants.",
);
export let azureServerCouldNotStart = l10n.t(
    "Server could not start. This could be a permissions error or an incompatibility on your system. You can try enabling device code authentication from settings.",
);
export let azureAuthNonceError = l10n.t(
    "Authentication failed due to a nonce mismatch, please close Azure Data Studio and try again.",
);
export let azureAuthStateError = l10n.t(
    "Authentication failed due to a state mismatch, please close ADS and try again.",
);
export let encryptPrompt = l10n.t("Encrypt");
export let encryptName = l10n.t("encrypt");
export let encryptOptional = l10n.t("Optional (False)");
export let encryptMandatory = l10n.t("Mandatory (True)");
export let encryptMandatoryRecommended = l10n.t("Mandatory (Recommended)");
export let enableTrustServerCertificate = l10n.t("Enable Trust Server Certificate");
export let readMore = l10n.t("Read more");
export let msgCopyAndOpenWebpage = l10n.t("Copy code and open webpage");
export let azureChooseAccount = l10n.t("Choose a Microsoft Entra account");
export let azureAddAccount = l10n.t("Add a Microsoft Entra account...");
export function accountAddedSuccessfully(account: string) {
    return l10n.t({
        message: "Microsoft Entra account {0} successfully added.",
        args: [account],
        comment: ["{0} is the account name"],
    });
}
export let accountCouldNotBeAdded = l10n.t("New Microsoft Entra account could not be added.");
export let accountRemovedSuccessfully = l10n.t(
    "Selected Microsoft Entra account removed successfully.",
);
export function accountRemovalFailed(error: string) {
    return l10n.t({
        message: "An error occurred while removing Microsoft Entra account: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export let noAzureAccountForRemoval = l10n.t(
    "No Microsoft Entra account can be found for removal.",
);
export let clearedAzureTokenCache = l10n.t("Azure token cache cleared successfully.");
export let cannotConnect = l10n.t(
    "Cannot connect due to expired tokens. Please re-authenticate and try again.",
);
export let aad = l10n.t("Microsoft Entra Id");
export let azureChooseTenant = l10n.t("Choose a Microsoft Entra tenant");
export let tenant = l10n.t("Tenant");
export let usernamePrompt = l10n.t("User name");
export let usernamePlaceholder = l10n.t("User name (SQL Login)");
export let passwordPrompt = l10n.t("Password");
export let passwordPlaceholder = l10n.t("Password (SQL Login)");
export let msgSavePassword = l10n.t(
    "Save Password? If 'No', password will be required each time you connect",
);
export let profileNamePrompt = l10n.t("Profile Name");
export let profileNamePlaceholder = l10n.t(
    "[Optional] Enter a display name for this connection profile",
);
export let msgCannotOpenContent = l10n.t("Error occurred opening content in editor.");
export let msgSaveStarted = l10n.t("Started saving results to ");
export let msgSaveFailed = l10n.t("Failed to save results. ");
export let msgSaveSucceeded = l10n.t("Successfully saved results to ");
export let msgSelectProfileToRemove = l10n.t("Select profile to remove");
export let confirmRemoveProfilePrompt = l10n.t("Confirm to remove this profile.");
export let msgNoProfilesSaved = l10n.t("No connection profile to remove.");
export let msgProfileRemoved = l10n.t("Profile removed successfully");
export let msgProfileCreated = l10n.t("Profile created successfully");
export let msgProfileCreatedAndConnected = l10n.t("Profile created and connected");
export let msgClearedRecentConnections = l10n.t("Recent connections list cleared");
export let msgIsRequired = l10n.t(" is required.");
export let msgError = l10n.t("Error: ");
export let msgYes = l10n.t("Yes");
export let msgNo = l10n.t("No");
export let defaultDatabaseLabel = l10n.t("<default>");
export let connectingTooltip = l10n.t("Connecting to: ");
export let connectErrorTooltip = l10n.t("Error connecting to: ");
export let connectErrorCode = l10n.t("Error code: ");
export let connectErrorMessage = l10n.t("Error Message: ");
export let cancelingQueryLabel = l10n.t("Canceling query ");
export let updatingIntelliSenseLabel = l10n.t("Updating IntelliSense...");
export let extensionNotInitializedError = l10n.t(
    "Unable to execute the command while the extension is initializing. Please try again later.",
);
export let untitledScheme = l10n.t("untitled");
export let msgChangeLanguageMode = l10n.t(
    'To use this command, you must set the language to "SQL". Confirm to change language mode.',
);
export function msgChangedDatabaseContext(databaseName: string, documentName: string) {
    return l10n.t({
        message: 'Changed database context to "{0}" for document "{1}"',
        args: [databaseName, documentName],
        comment: ["{0} is the database name", "{1} is the document name"],
    });
}
export let msgPromptRetryCreateProfile = l10n.t(
    "Error: Unable to connect using the connection information provided. Retry profile creation?",
);
export let refreshTokenLabel = l10n.t("Refresh Credentials");
export let msgGetTokenFail = l10n.t("Failed to fetch user tokens.");
export let msgPromptRetryConnectionDifferentCredentials = l10n.t(
    "Error: Login failed. Retry using different credentials?",
);
export let msgPromptSSLCertificateValidationFailed = l10n.t(
    "Encryption was enabled on this connection; review your SSL and certificate configuration for the target SQL Server, or set 'Trust server certificate' to 'true' in the settings file. Note: A self-signed certificate offers only limited protection and is not a recommended practice for production environments. Do you want to enable 'Trust server certificate' on this connection and retry?",
);
export let msgPromptRetryFirewallRuleNotSignedIn = l10n.t(
    "Your client IP address does not have access to the server. Add a Microsoft Entra account and create a new firewall rule to enable access.",
);
export function msgPromptRetryFirewallRuleSignedIn(clientIp: string, serverName: string) {
    return l10n.t({
        message:
            "Your client IP Address '{0}' does not have access to the server '{1}' you're attempting to connect to. Would you like to create new firewall rule?",
        args: [clientIp, serverName],
        comment: ["{0} is the client IP address", "{1} is the server name"],
    });
}
export let msgPromptRetryFirewallRuleAdded = l10n.t(
    "Firewall rule successfully added. Retry profile creation? ",
);
export let msgAccountRefreshFailed = l10n.t(
    "Credential Error: An error occurred while attempting to refresh account credentials. Please re-authenticate.",
);
export let msgPromptProfileUpdateFailed = l10n.t(
    "Connection Profile could not be updated. Please modify the connection details manually in settings.json and try again.",
);
export let msgUnableToExpand = l10n.t("Unable to expand. Please check logs for more information.");
export let msgPromptFirewallRuleCreated = l10n.t("Firewall rule successfully created.");
export let msgAuthTypeNotFound = l10n.t(
    "Failed to get authentication method, please remove and re-add the account.",
);
export let msgAccountNotFound = l10n.t("Account not found");
export let msgChooseQueryHistory = l10n.t("Choose Query History");
export let msgChooseQueryHistoryAction = l10n.t("Choose An Action");
export let msgOpenQueryHistory = l10n.t("Open Query History");
export let msgRunQueryHistory = l10n.t("Run Query History");
export let msgInvalidIpAddress = l10n.t("Invalid IP Address");
export let msgInvalidRuleName = l10n.t("Invalid Firewall rule name");
export let msgNoQueriesAvailable = l10n.t("No Queries Available");
export let retryLabel = l10n.t("Retry");
export let createFirewallRuleLabel = l10n.t("Create Firewall Rule");
export function msgConnecting(serverName: string, documentName: string) {
    return l10n.t({
        message: 'Connecting to server "{0}" on document "{1}".',
        args: [serverName, documentName],
        comment: ["{0} is the server name", "{1} is the document name"],
    });
}
export function msgConnectionNotFound(uri: string) {
    return l10n.t({
        message: 'Connection not found for uri "{0}".',
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgFoundPendingReconnect(uri: string) {
    return l10n.t({
        message: "Found pending reconnect promise for uri {0}, waiting.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgPendingReconnectSuccess(uri: string) {
    return l10n.t({
        message: "Previous pending reconnection for uri {0}, succeeded.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgFoundPendingReconnectFailed(uri: string) {
    return l10n.t({
        message: "Found pending reconnect promise for uri {0}, failed.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
export function msgFoundPendingReconnectError(uri: string, error: string) {
    return l10n.t({
        message:
            "Previous pending reconnect promise for uri {0} is rejected with error {1}, will attempt to reconnect if necessary.",
        args: [uri, error],
        comment: ["{0} is the uri", "{1} is the error"],
    });
}
export function msgAcessTokenExpired(connectionId: string, uri: string) {
    return l10n.t({
        message: "Access token expired for connection {0} with uri {1}",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export let msgRefreshTokenError = l10n.t("Error when refreshing token");
export let msgAzureCredStoreSaveFailedError = l10n.t(
    'Keys for token cache could not be saved in credential store, this may cause Microsoft Entra Id access token persistence issues and connection instabilities. It\'s likely that SqlTools has reached credential storage limit on Windows, please clear at least 2 credentials that start with "Microsoft.SqlTools|" in Windows Credential Manager and reload.',
);
export function msgRefreshConnection(connectionId: string, uri: string) {
    return l10n.t({
        message: "Failed to refresh connection ${0} with uri {1}, invalid connection result.",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export function msgRefreshTokenSuccess(connectionId: string, uri: string, message: string) {
    return l10n.t({
        message: "Successfully refreshed token for connection {0} with uri {1}, {2}",
        args: [connectionId, uri, message],
        comment: ["{0} is the connection id", "{1} is the uri", "{2} is the message"],
    });
}
export function msgRefreshTokenNotNeeded(connectionId: string, uri: string) {
    return l10n.t({
        message:
            "No need to refresh Microsoft Entra acccount token for connection {0} with uri {1}",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export function msgConnectedServerInfo(
    serverName: string,
    documentName: string,
    serverInfo: string,
) {
    return l10n.t({
        message: 'Connected to server "{0}" on document "{1}". Server information: {2}',
        args: [serverName, documentName, serverInfo],
        comment: ["{0} is the server name", "{1} is the document name", "{2} is the server info"],
    });
}
export function msgConnectionFailed(serverName: string, errorMessage: string) {
    return l10n.t({
        message: 'Error connecting to server "{0}". Details: {1}',
        args: [serverName, errorMessage],
        comment: ["{0} is the server name", "{1} is the error message"],
    });
}
export function msgChangingDatabase(
    databaseName: string,
    serverName: string,
    documentName: string,
) {
    return l10n.t({
        message: 'Changing database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: ["{0} is the database name", "{1} is the server name", "{2} is the document name"],
    });
}
export function msgChangedDatabase(databaseName: string, serverName: string, documentName: string) {
    return l10n.t({
        message: 'Changed database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: ["{0} is the database name", "{1} is the server name", "{2} is the document name"],
    });
}
export function msgDisconnected(documentName: string) {
    return l10n.t({
        message: 'Disconnected on document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export let macOpenSslErrorMessage = l10n.t("OpenSSL version >=1.0.1 is required to connect.");
export let macOpenSslHelpButton = l10n.t("Help");
export let macSierraRequiredErrorMessage = l10n.t(
    "macOS Sierra or newer is required to use this feature.",
);
export let gettingDefinitionMessage = l10n.t("Getting definition ...");
export let definitionRequestedStatus = l10n.t("DefinitionRequested");
export let definitionRequestCompletedStatus = l10n.t("DefinitionRequestCompleted");
export let updatingIntelliSenseStatus = l10n.t("updatingIntelliSense");
export let intelliSenseUpdatedStatus = l10n.t("intelliSenseUpdated");
export let testLocalizationConstant = l10n.t("test");
export let disconnectOptionLabel = l10n.t("Disconnect");
export let disconnectOptionDescription = l10n.t("Close the current connection");
export let disconnectConfirmationMsg = l10n.t("Are you sure you want to disconnect?");
export function elapsedBatchTime(batchTime: string) {
    return l10n.t({
        message: "Batch execution time: {0}",
        args: [batchTime],
        comment: ["{0} is the batch time"],
    });
}
export let noActiveEditorMsg = l10n.t("A SQL editor must have focus before executing this command");
export let maximizeLabel = l10n.t("Maximize");
export let restoreLabel = l10n.t("Restore");
export let saveCSVLabel = l10n.t("Save as CSV");
export let saveJSONLabel = l10n.t("Save as JSON");
export let saveExcelLabel = l10n.t("Save as Excel");
export let fileTypeCSVLabel = l10n.t("CSV");
export let fileTypeJSONLabel = l10n.t("JSON");
export let fileTypeExcelLabel = l10n.t("Excel");
export let resultPaneLabel = l10n.t("Results");
export let selectAll = l10n.t("Select all");
export let copyLabel = l10n.t("Copy");
export let copyWithHeadersLabel = l10n.t("Copy with Headers");
export let executeQueryLabel = l10n.t("Executing query...");
export let QueryExecutedLabel = l10n.t("Query executed");
export let messagePaneLabel = l10n.t("Messages");
export let messagesTableTimeStampColumn = l10n.t("Timestamp");
export let messagesTableMessageColumn = l10n.t("Message");
export function lineSelectorFormatted(lineNumber: number) {
    return l10n.t({
        message: "Line {0}",
        args: [lineNumber],
        comment: ["{0} is the line number"],
    });
}
export function elapsedTimeLabel(elapsedTime: string) {
    return l10n.t({
        message: "Total execution time: {0}",
        args: [elapsedTime],
        comment: ["{0} is the elapsed time"],
    });
}
export let msgCannotSaveMultipleSelections = l10n.t(
    "Save results command cannot be used with multiple selections.",
);
export let mssqlProviderName = l10n.t("MSSQL");
export let noneProviderName = l10n.t("None");
export let flavorChooseLanguage = l10n.t("Choose SQL Language");
export let flavorDescriptionMssql = l10n.t(
    "Use T-SQL intellisense and syntax error checking on current document",
);
export let flavorDescriptionNone = l10n.t(
    "Disable intellisense and syntax error checking on current document",
);
export let autoDisableNonTSqlLanguageServicePrompt = l10n.t(
    "Non-SQL Server SQL file detected. Disable IntelliSense for such files?",
);
export let msgAddConnection = l10n.t("Add Connection");
export let msgConnect = l10n.t("Connect");
export let azureSignIn = l10n.t("Azure: Sign In");
export let azureSignInDescription = l10n.t("Sign in to your Azure subscription");
export let azureSignInWithDeviceCode = l10n.t("Azure: Sign In with Device Code");
export let azureSignInWithDeviceCodeDescription = l10n.t(
    "Sign in to your Azure subscription with a device code. Use this in setups where the Sign In command does not work",
);
export let azureSignInToAzureCloud = l10n.t("Azure: Sign In to Azure Cloud");
export let azureSignInToAzureCloudDescription = l10n.t(
    "Sign in to your Azure subscription in one of the sovereign clouds.",
);
export function taskStatusWithName(taskName: string, status: string) {
    return l10n.t({
        message: "{0}: {1}",
        args: [taskName, status],
        comment: ["{0} is the task name", "{1} is the status"],
    });
}
export function taskStatusWithMessage(status: string, message: string) {
    return l10n.t({
        message: "{0}. {1}",
        args: [status, message],
        comment: ["{0} is the status", "{1} is the message"],
    });
}
export function taskStatusWithNameAndMessage(taskName: string, status: string, message: string) {
    return l10n.t({
        message: "{0}: {1}. {2}",
        args: [taskName, status, message],
        comment: ["{0} is the task name", "{1} is the status", "{2} is the message"],
    });
}
export let failed = l10n.t("Failed");
export let succeeded = l10n.t("Succeeded");
export let succeededWithWarning = l10n.t("Succeeded with warning");
export let canceled = l10n.t("Canceled");
export let inProgress = l10n.t("In progress");
export let canceling = l10n.t("Canceling");
export let notStarted = l10n.t("Not started");
export let nodeErrorMessage = l10n.t("Parent node was not TreeNodeInfo.");
export function deleteCredentialError(id: string, error: string) {
    return l10n.t({
        message: "Failed to delete credential with id: {0}. {1}",
        args: [id, error],
        comment: ["{0} is the id", "{1} is the error"],
    });
}
export let msgClearedRecentConnectionsWithErrors = l10n.t(
    "The recent connections list has been cleared but there were errors while deleting some associated credentials. View the errors in the MSSQL output channel.",
);
export let connectProgressNoticationTitle = l10n.t("Testing connection profile...");
export let msgMultipleSelectionModeNotSupported = l10n.t(
    "Running query is not supported when the editor is in multiple selection mode.",
);
export let newColumnWidthPrompt = l10n.t("Enter new column width");
export let columnWidthInvalidNumberError = l10n.t("Invalid column width");
export let columnWidthMustBePositiveError = l10n.t("Width cannot be 0 or negative");
export let objectExplorerNodeRefreshError = l10n.t(
    "An error occurred refreshing nodes. See the MSSQL output channel for more details.",
);
export let showOutputChannelActionButtonText = l10n.t("Show MSSQL output");
export let reloadPrompt = l10n.t(
    "Authentication Library has changed, please reload Visual Studio Code.",
);
export let reloadPromptGeneric = l10n.t(
    "Visual Studio Code must be relaunched for this setting to come into effect.  Please reload Visual Studio Code.",
);
export let reloadChoice = l10n.t("Reload Visual Studio Code");
export let switchToMsal = l10n.t("Switch to MSAL");
export let dismiss = l10n.t("Dismiss");
export let querySuccess = l10n.t("Query succeeded");
export let queryFailed = l10n.t("Query failed");

export let parameters = l10n.t("Parameters");
export let loading = l10n.t("Loading");
export let executionPlan = l10n.t("Execution Plan");
export let executionPlanFileFilter = l10n.t("SQL Plan Files");
export let scriptCopiedToClipboard = l10n.t("Script copied to clipboard");
export let copied = l10n.t("Copied");

export let openQueryResultsInTabByDefaultPrompt = l10n.t(
    "Do you want to always display query results in a new tab instead of the query pane?",
);
export let alwaysShowInNewTab = l10n.t("Always show in new tab");
export let keepInQueryPane = l10n.t("Keep in query pane");
export let inMemoryDataProcessingThresholdExceeded = l10n.t(
    "Max row count for filtering/sorting has been exceeded. To update it, navigate to User Settings and change the setting: mssql.resultsGrid.inMemoryDataProcessingThreshold",
);

export function enableRichExperiencesPrompt(learnMoreUrl: string) {
    return l10n.t({
        message:
            "The MSSQL for VS Code extension is introducing new modern data development features! Would you like to enable them? [Learn more]({0})",
        args: [learnMoreUrl],
        comment: ["{0} is a url to learn more about the new features"],
    });
}
export let enableRichExperiences = l10n.t("Enable Experiences & Reload");

export class ObjectExplorer {
    public static ErrorLoadingRefreshToTryAgain = l10n.t("Error loading; refresh to try again");
    public static NoItems = l10n.t("No items");
    public static FailedOEConnectionError = l10n.t(
        "We couldn't connect using the current connection information. Would you like to retry the connection or edit the connection profile?",
    );
    public static FailedOEConnectionErrorRetry = l10n.t("Retry");
    public static FailedOEConnectionErrorUpdate = l10n.t("Edit Connection Profile");
    public static Connecting = l10n.t("Connecting...");
    public static NodeDeletionConfirmation(nodeLabel: string) {
        return l10n.t({
            message: "Are you sure you want to remove {0}?",
            args: [nodeLabel],
            comment: ["{0} is the node label"],
        });
    }
    public static NodeDeletionConfirmationYes = l10n.t("Yes");
    public static NodeDeletionConfirmationNo = l10n.t("No");
    public static LoadingNodeLabel = l10n.t("Loading...");
    public static FetchingScriptLabel(scriptType: string) {
        return l10n.t({
            message: "Fetching {0} script...",
            args: [scriptType],
            comment: ["{0} is the script type"],
        });
    }
    public static ScriptSelectLabel = l10n.t("Select");
    public static ScriptCreateLabel = l10n.t("Create");
    public static ScriptInsertLabel = l10n.t("Insert");
    public static ScriptUpdateLabel = l10n.t("Update");
    public static ScriptDeleteLabel = l10n.t("Delete");
    public static ScriptExecuteLabel = l10n.t("Execute");
    public static ScriptAlterLabel = l10n.t("Alter");
    public static AzureSignInMessage = l10n.t("Signing in to Azure...");

    public static ConnectionGroupDeletionConfirmationWithContents(groupName: string) {
        return l10n.t({
            message:
                "Are you sure you want to delete {0}?  You can delete its connections as well, or move them to the root folder.",
            args: [groupName],
            comment: ["{0} is the group name"],
        });
    }

    public static ConnectionGroupDeleteContents = l10n.t("Delete Contents");
    public static ConnectionGroupMoveContents = l10n.t("Move to Root");

    public static ConnectionGroupDeletionConfirmationWithoutContents(groupName: string) {
        return l10n.t({
            message: "Are you sure you want to delete {0}?",
            args: [groupName],
            comment: ["{0} is the group name"],
        });
    }
}

export class ConnectionDialog {
    public static connectionDialog = l10n.t("Connection Dialog");
    public static azureAccount = l10n.t("Azure Account");
    public static azureAccountIsRequired = l10n.t("Azure Account is required");
    public static selectAnAccount = l10n.t("Select an account");
    public static savePassword = l10n.t("Save Password");
    public static tenantId = l10n.t("Tenant ID");
    public static selectATenant = l10n.t("Select a tenant");
    public static tenantIdIsRequired = l10n.t("Tenant ID is required");
    public static profileName = l10n.t("Profile Name");
    public static connectionGroup = l10n.t("Connection Group");
    public static serverIsRequired = l10n.t("Server is required");
    public static usernameIsRequired = l10n.t("User name is required");
    public static connectionString = l10n.t("Connection String");
    public static connectionStringIsRequired = l10n.t("Connection string is required");
    public static signIn = l10n.t("Sign in");
    public static additionalParameters = l10n.t("Additional parameters");
    public static connect = l10n.t("Connect");
    public static default = l10n.t("<Default>");
    public static createConnectionGroup = l10n.t("+ Create Connection Group");
    public static selectConnectionGroup = l10n.t("Select a connection group");
    public static searchConnectionGroups = l10n.t("Search connection groups");

    public static errorLoadingAzureDatabases(subscriptionName: string, subscriptionId: string) {
        return l10n.t({
            message:
                "Error loading Azure databases for subscription {0} ({1}).  Confirm that you have permission.",
            args: [subscriptionName, subscriptionId],
            comment: ["{0} is the subscription name", "{1} is the subscription id"],
        });
    }
    public static deleteTheSavedConnection = (connectionName: string) => {
        return l10n.t({
            message: "delete the saved connection: {0}?",
            args: [connectionName],
            comment: ["{0} is the connection name"],
        });
    };
    public static multipleMatchingTokensError(accountDisplayName?: string, tenantId?: string) {
        if (!accountDisplayName || !tenantId) {
            return l10n.t(
                "Authentication error for account. Resolving this requires clearing your token cache, which will sign you out of all connected accounts.",
            );
        }
        return l10n.t({
            message:
                "Authentication error for account '{0}' (tenant '{1}'). Resolving this requires clearing your token cache, which will sign you out of all connected accounts.",
            args: [accountDisplayName, tenantId],
            comment: ["{0} is the account display name", "{1} is the tenant id"],
        });
    }
    public static ClearCacheAndRefreshToken = l10n.t("Clear cache and refresh token");
}

export class FirewallRule {
    public static addFirewallRule = l10n.t("Add Firewall Rule");
    public static addFirewallRuleToServer = (serverName: string) => {
        return l10n.t({
            message: "Add Firewall Rule to {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
}

export class Azure {
    public static azureSignInFailedOrWasCancelled = l10n.t(
        "Azure sign-in failed or was cancelled.",
    );

    public static errorLoadingAzureAccountInfoForTenantId = (tenantId: string) => {
        return l10n.t({
            message: "Error loading Azure account information for tenant ID '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };

    public static errorCreatingFirewallRule = (ruleInfo: string, error: string) => {
        return l10n.t({
            message:
                "Error creating firewall rule {0}.  Check your Azure account settings and try again.  Error: {1}",
            args: [ruleInfo, error],
            comment: [
                "{0} is the rule info in format 'name (startIp - endIp)'",
                "{1} is the error message",
            ],
        });
    };
}

export class QueryResult {
    public static nonNumericSelectionSummary = (
        count: number,
        distinctCount: number,
        nullCount: number,
    ) =>
        l10n.t({
            message: "Count: {0}  Distinct Count: {1}  Null Count: {2}",
            args: [count, distinctCount, nullCount],
            comment: ["{0} is the count, {1} is the distinct count, and {2} is the null count"],
        });
    public static numericSelectionSummary = (average: string, count: number, sum: number) =>
        l10n.t({
            message: "Average: {0}  Count: {1}  Sum: {2}",
            args: [average, count, sum],
            comment: ["{0} is the average, {1} is the count, {2} is the sum"],
        });
    public static numericSelectionSummaryTooltip = (
        average: string,
        count: number,
        distinctCount: number,
        max: number,
        min: number,
        nullCount: number,
        sum: number,
    ) =>
        l10n.t({
            message:
                "Average: {0}  Count: {1}  Distinct Count: {2}  Max: {3}  Min: {4}  Null Count: {5}  Sum: {6}",
            args: [average, count, distinctCount, max, min, nullCount, sum],
            comment: [
                "{0} is the average, {1} is the count, {2} is the distinct count, {3} is the max, {4} is the min, {5} is the null count, {6} is the sum",
            ],
        });
}

export class ContainerDeployment {
    public static createLocalSqlContainer = l10n.t("Create Local SQL Container");
    public static stoppedContainerSucessfully = (name: string) =>
        l10n.t({
            message: "{0} stopped successfully.",
            args: [name],
            comment: ["{0} stopped successfully."],
        });
    public static failStopContainer = (name: string) =>
        l10n.t({
            message: "Failed to stop {0}.",
            args: [name],
            comment: ["Failed to stop {0}."],
        });
    public static startedContainerSucessfully = (name: string) =>
        l10n.t({
            message: "{0} started successfully.",
            args: [name],
            comment: ["{0} started successfully."],
        });
    public static startingContainer = (name: string) =>
        l10n.t({
            message: "Starting {0}...",
            args: [name],
            comment: ["{0} is the container name"],
        });
    public static failStartContainer = (name: string) =>
        l10n.t({
            message: "Failed to start {0}.",
            args: [name],
            comment: ["Failed to start {0}."],
        });
    public static deletedContainerSucessfully = (name: string) =>
        l10n.t({
            message: "{0} deleted successfully.",
            args: [name],
            comment: ["{0} deleted successfully."],
        });
    public static failDeleteContainer = (name: string) =>
        l10n.t({
            message: "Failed to delete {0}.",
            args: [name],
            comment: ["Failed to delete {0}."],
        });
    public static selectImage = l10n.t("Select image");
    public static selectImageTooltip = l10n.t("Select the SQL Server Container Image");
    public static sqlServerVersionImage = (version: string) =>
        l10n.t({
            message: "SQL Server {0} - latest",
            args: [version],
            comment: ["{0} is the SQL Server version"],
        });
    public static sqlServerPasswordTooltip = l10n.t("SQL Server Container SA Password");
    public static pleaseChooseUniqueProfileName = l10n.t(
        "Please choose a unique name for the profile",
    );
    public static containerName = l10n.t("Container Name");
    public static containerNameTooltip = l10n.t(
        "Choose a name for the SQL Server Docker Container",
    );
    public static pleaseChooseUniqueContainerName = l10n.t(
        "Please choose a unique name for the container",
    );
    public static port = l10n.t("Port");
    public static portTooltip = l10n.t("Choose a port to host the SQL Server Docker Container");
    public static pleaseChooseUnusedPort = l10n.t(
        "Please make sure the port is a number, and choose a port that is not in use",
    );
    public static hostname = l10n.t("Hostname");
    public static hostnameTooltip = l10n.t("Choose a hostname for the container");
    public static termsAndConditions = l10n.t("Terms & Conditions");
    public static acceptSqlServerEulaTooltip = l10n.t(
        "Accept the SQL Server EULA to deploy a SQL Server Docker container",
    );
    public static acceptSqlServerEula = l10n.t("Please Accept the SQL Server EULA");
    public static dockerInstallHeader = l10n.t("Checking if Docker is installed");
    public static dockerInstallBody = l10n.t("Checking if Docker is installed on your machine");
    public static dockerInstallError = l10n.t(
        "Docker is not installed or not in PATH. Please install Docker Desktop and try again.",
    );
    public static startDockerHeader = l10n.t("Checking if Docker is started");
    public static startDockerBody = l10n.t(
        "Checking if Docker is running on your machine. If not, we'll start it for you.",
    );
    public static dockerError = l10n.t(
        "Error running Docker commands. Please make sure Docker is running.",
    );
    public static startDockerEngineHeader = l10n.t("Checking Docker Engine Configuration");
    public static startDockerEngineBody = l10n.t(
        "Checking if the Docker Engine is configured correctly on your machine.",
    );
    public static creatingContainerHeader = l10n.t("Creating Container");
    public static creatingContainerBody = l10n.t(
        "Creating and starting your SQL Server Docker container",
    );
    public static settingUpContainerHeader = l10n.t("Setting up container");
    public static settingUpContainerBody = l10n.t("Readying container for connections.");
    public static connectingToContainerHeader = l10n.t("Connecting to Container");
    public static connectingToContainerBody = l10n.t(
        "Connecting to your SQL Server Docker container",
    );
    public static passwordLengthError = l10n.t("Please make your password 8-128 characters long.");
    public static passwordComplexityError = l10n.t(
        "Your password must contain characters from at least three of the following categories: uppercase letters, lowercase letters, numbers (0-9), and special characters (!, $, #, %, etc.).",
    );
    public static unsupportedDockerPlatformError = (platform: string) =>
        l10n.t({
            message: "Unsupported platform for Docker: {0}",
            args: [platform],
            comment: ["{0} is the platform name of the machine"],
        });
    public static rosettaError = l10n.t(
        "Please make sure Rosetta Virtualization is enabled. You can do this within your Docker Desktop settings.",
    );
    public static windowsContainersError = l10n.t(
        "SQL Server does not support Windows containers. Please switch to Linux containers in Docker Desktop settings.",
    );
    public static linuxDockerPermissionsError = l10n.t(
        "Docker requires root permissions to run. Please run Docker with sudo or add your user to the docker group using sudo usermod -aG docker $USER. Then, reboot your machine and retry.",
    );
    public static dockerFailedToStartWithinTimeout = l10n.t(
        "Docker failed to start within the timeout period. Please manually start Docker and try again.",
    );
    public static containerFailedToStartWithinTimeout = l10n.t(
        "Container failed to start within the timeout period. Please wait a few minutes and try again.",
    );
    public static dockerDesktopPathError = l10n.t(
        "We can't find where Docker Desktop is located on your machine. Please manually start Docker Desktop and try again.",
    );
    public static installDocker = l10n.t("Install Docker");
    public static msgCreateLocalSqlContainer = l10n.t("Create Local SQL Container");
    public static startingContainerLoadingLabel = l10n.t("Starting Container...");
    public static stoppingContainerLoadingLabel = l10n.t("Stopping Container...");
    public static deletingContainerLoadingLabel = l10n.t("Deleting Container...");
    public static deleteContainerConfirmation = (containerName: string) => {
        return l10n.t({
            message:
                "Are you sure you want to delete the container {0}? This will remove both the container and its connection from VS Code.",
            args: [containerName],
            comment: ["{0} is the container name"],
        });
    };
    public static configureLinuxContainers = l10n.t("Configure Linux containers");
    public static switchToLinuxContainersConfirmation = l10n.t(
        "Your Docker Engine currently runs Windows containers. SQL Server only supports Linux containers. Would you like to switch to Linux containers?",
    );
    public static switchToLinuxContainersCanceled = l10n.t(
        "Switching to Linux containers was canceled. SQL Server only supports Linux containers.",
    );
    public static startSqlServerContainerError = l10n.t(
        "Failed to start SQL Server container. Please check the error message for more details, and then try again.",
    );
    public static containerDoesNotExistError = l10n.t(
        "Container does not exist. Would you like to remove the connection?",
    );
}

export class UserSurvey {
    public static overallHowSatisfiedAreYouWithMSSQLExtension = l10n.t(
        "Overall, how satisfied are you with the MSSQL extension?",
    );
    public static howlikelyAreYouToRecommendMSSQLExtension = l10n.t(
        "How likely it is that you would recommend the MSSQL extension to a friend or colleague?",
    );
    public static whatCanWeDoToImprove = l10n.t("What can we do to improve?");
    public static takeSurvey = l10n.t("Take Survey");
    public static doYouMindTakingAQuickFeedbackSurvey = l10n.t(
        "Do you mind taking a quick feedback survey about the MSSQL Extension for VS Code?",
    );
    public static mssqlFeedback = l10n.t("MSSQL Feedback");
    public static privacyDisclaimer = l10n.t(
        "Microsoft reviews your feedback to improve our products, so don't share any personal data or confidential/proprietary content.",
    );
    public static overallHowStatisfiedAreYouWithFeature = (featureName: string) =>
        l10n.t({
            message: "Overall, how satisfied are you with {0}?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });

    public static howLikelyAreYouToRecommendFeature = (featureName: string) =>
        l10n.t({
            message: "How likely it is that you would recommend {0} to a friend or colleague?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });
    public static fileAnIssuePrompt = l10n.t(
        "Encountering a problem?  Share the details with us by opening a GitHub issue so we can improve!",
    );
    public static submitIssue = l10n.t("Submit an issue");
}

export class Webview {
    public static webviewRestorePrompt = (webviewName: string) =>
        l10n.t({
            message: "{0} has been closed. Would you like to restore it?",
            args: [webviewName],
            comment: ["{0} is the webview name"],
        });
    public static Restore = l10n.t("Restore");
}

export class TableDesigner {
    public static General = l10n.t("General");
    public static Columns = l10n.t("Columns");
    public static AdvancedOptions = l10n.t("Advanced Options");
}

export class SchemaCompare {
    public static Title = l10n.t("Schema Compare (Preview)");
    public static Open = l10n.t("Open");
    public static Save = l10n.t("Save");
    public static defaultUserName = l10n.t("default");
    public static Yes = l10n.t("Yes");
    public static No = l10n.t("No");
    public static optionsChangedMessage = l10n.t(
        "Options have changed. Recompare to see the comparison?",
    );
    public static generateScriptErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Failed to generate script: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the generate script operation"],
        });
    public static areYouSureYouWantToUpdateTheTarget = l10n.t(
        "Are you sure you want to update the target?",
    );
    public static schemaCompareApplyFailed = (errorMessage: string) =>
        l10n.t({
            message: "Failed to apply changes: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the publish changes operation"],
        });
    public static openScmpErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open scmp file: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the open scmp operation"],
        });
    public static saveScmpErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Failed to save scmp file: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the save scmp operation"],
        });
    public static cancelErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Cancel schema compare failed: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the cancel operation"],
        });
    public static compareErrorMessage = (errorMessage: string) =>
        l10n.t({
            message: "Schema Compare failed: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the compare operation"],
        });
    public static cannotExcludeEntryWithBlockingDependency = (
        diffEntryName: string,
        firstDependentName: string,
    ) =>
        l10n.t({
            message: "Cannot exclude {0}. Included dependents exist, such as {1}",
            args: [diffEntryName, firstDependentName],
            comment: [
                "{0} is the name of the entry",
                "{1} is the name of the blocking dependency preventing exclusion.",
            ],
        });
    public static cannotIncludeEntryWithBlockingDependency = (
        diffEntryName: string,
        firstDependentName: string,
    ) =>
        l10n.t({
            message: "Cannot include {0}. Excluded dependents exist, such as {1}",
            args: [diffEntryName, firstDependentName],
            comment: [
                "{0} is the name of the entry",
                "{1} is the name of the blocking dependency preventing inclusion.",
            ],
        });
    public static cannotExcludeEntry = (diffEntryName: string) =>
        l10n.t({
            message: "Cannot exclude {0}. Included dependents exist",
            args: [diffEntryName],
            comment: ["{0} is the name of the entry"],
        });
    public static cannotIncludeEntry = (diffEntryName: string) =>
        l10n.t({
            message: "Cannot include {0}. Excluded dependents exist",
            args: [diffEntryName],
            comment: ["{0} is the name of the entry"],
        });
}

export class SchemaDesigner {
    public static LoadingSchemaDesginerModel = l10n.t("Loading Schema Designer Model...");
    public static SchemaReady = l10n.t(
        "Schema Designer Model is ready. Changes can now be published.",
    );
    public static SaveAs = l10n.t("Save As");
    public static Save = l10n.t("Save");
    public static SchemaDesigner = l10n.t("Schema Designer");
    public static tabTitle(databaseName: string) {
        return l10n.t({
            message: "{0} (Preview)",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    public static OpeningPublishScript = l10n.t("Opening Publish Script. This may take a while...");
    public static GeneratingReport = l10n.t("Generating Report. This may take a while...");
    public static PublishScriptFailed = (errorMessage: string) =>
        l10n.t({
            message: "Failed to generate publish script: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the generate script operation"],
        });
}

export class StatusBar {
    public static disconnectedLabel = l10n.t("Connect to MSSQL");
    public static notConnectedTooltip = l10n.t("Click to connect to a database");
    public static connectingLabel = l10n.t("Connecting");
    public static connectErrorLabel = l10n.t("Connection error"); // {0} is the server name
}

export class Connection {
    public static missingConnectionIdsError = (connectionDisplayNames: string[]) => {
        return l10n.t({
            message:
                "The following workspace or workspace folder connections are missing the 'id' property and are being ignored.  Please manually add the 'id' property to the connection in order to use it. \n\n {0}",
            args: [connectionDisplayNames.join("\n")],
            comment: [
                "{0} is the list of display names for the connections that have been ignored",
            ],
        });
    };

    public static missingConnectionInformation = (connectionId: string) => {
        return l10n.t({
            message:
                "The connection with ID '{0}' does not have the 'server' property set and is being ignored.  Please set the 'server' property on this connection in order to use it.",
            args: [connectionId],
            comment: ["{0} is the connection ID for the connection that has been ignored"],
        });
    };

    public static errorMigratingLegacyConnection = (connectionId: string, errorMessage: string) => {
        return l10n.t({
            message:
                "Error migrating connection ID {0} to new format.  Please recreate this connection to use it.\nError:\n{1}",
            args: [connectionId, errorMessage],
            comment: ["{0} is the connection id", "{1} is the error message"],
        });
    };
}

export class MssqlChatAgent {
    public static noModelFound = l10n.t("No model found.");
    public static noToolsToProcess = l10n.t("No tools to process.");
    public static notConnected = l10n.t("You are not connected to any database.");
    public static connectedTo = l10n.t("Connected to:");
    public static server = (serverName: string) => {
        return l10n.t({
            message: "Server - {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static database = (databaseName: string) => {
        return l10n.t({
            message: "Database - {0}",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    };
    public static usingModel = (modelName: string, canSendRequest: boolean | undefined) => {
        return l10n.t({
            message: "Using {0} ({1})...",
            args: [modelName, canSendRequest],
            comment: ["{0} is the model name", "{1} is whether the model can send requests"],
        });
    };
    public static toolLookupFor = (partName: string, partInput: string) => {
        return l10n.t({
            message: "Tool lookup for: {0} - {1}.",
            args: [partName, partInput],
            comment: ["{0} is the part name", "{1} is the part input"],
        });
    };
    public static gotInvalidToolUseParameters = (partInput: string, errorMessage: string) => {
        return l10n.t({
            message: 'Got invalid tool use parameters: "{0}". ({1})',
            args: [partInput, errorMessage],
            comment: ["{0} is the part input", "{1} is the error message"],
        });
    };
    public static callingTool = (toolFunctionName: string, sqlToolParameters: string) => {
        return l10n.t({
            message: "Calling tool: {0} with {1}.",
            args: [toolFunctionName, sqlToolParameters],
            comment: ["{0} is the tool function name", "{1} is the SQL tool parameters"],
        });
    };
    public static modelNotFoundError = l10n.t(
        "The requested model could not be found. Please check model availability or try a different model.",
    );
    public static noPermissionError = l10n.t(
        "Access denied. Please ensure you have the necessary permissions to use this tool or model.",
    );
    public static quoteLimitExceededError = l10n.t(
        "Usage limits exceeded. Try again later, or consider optimizing your requests.",
    );
    public static offTopicError = l10n.t(
        "I'm sorry, I can only assist with SQL-related questions.",
    );
    public static unexpectedError = l10n.t(
        "An unexpected error occurred with the language model. Please try again.",
    );
    public static usingModelToProcessRequest = (modelName: string) => {
        return l10n.t({
            message: "Using {0} to process your request...",
            args: [modelName],
            comment: ["{0} is the model name that will be processing the request"],
        });
    };
    public static languageModelDidNotReturnAnyOutput = l10n.t(
        "The language model did not return any output.",
    );
    public static errorOccurredWhileProcessingRequest = l10n.t(
        "An error occurred while processing your request.",
    );
    public static errorOccurredWith = (errorMessage: string) => {
        return l10n.t({
            message: "An error occurred: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    public static unknownErrorOccurred = l10n.t("An unknown error occurred. Please try again.");
    public static listServersToolConfirmationTitle = l10n.t("List Connections");
    public static listServersToolConfirmationMessage = l10n.t(
        "List all connections registered with the mssql extension?",
    );
    public static listServersToolInvocationMessage = l10n.t("Listing server connections");
    public static connectToolConfirmationTitle = l10n.t("Connect to Server");
    public static connectToolConfirmationMessageWithServerOnly = (serverName: string) => {
        return l10n.t({
            message: "Connect to server {0}?",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static connectToolConfirmationMessageWithServerAndDatabase = (
        serverName: string,
        databaseName: string,
    ) => {
        return l10n.t({
            message: "Connect to server {0} and database {1}?",
            args: [serverName, databaseName],
            comment: ["{0} is the server name", "{1} is the database name"],
        });
    };
    public static connectToolInvocationMessageWithServerOnly = (serverName: string) => {
        return l10n.t({
            message: "Connecting to server {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static connectToolInvocationMessageWithServerAndDatabase = (
        serverName: string,
        databaseName: string,
    ) => {
        return l10n.t({
            message: "Connecting to server {0} and database {1}",
            args: [serverName, databaseName],
            comment: ["{0} is the server name", "{1} is the database name"],
        });
    };
    public static connectToolServerNotFoundError = (serverName: string) => {
        return l10n.t({
            message: "Server {0} not found.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    public static connectToolSuccessMessage = l10n.t("Successfully connected to server.");
    public static connectToolFailMessage = l10n.t("Failed to connect to server.");
    public static connectToolProfileNotFoundError = (profileId: string) => {
        return l10n.t({
            message: "Connection profile '{0}' not found.",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    public static connectToolInvalidInputError = () => {
        return l10n.t("Either profileId or serverName must be provided.");
    };
    public static connectToolConfirmationMessageWithProfile = (profileId: string) => {
        return l10n.t({
            message: "Connect using profile {0}?",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    public static connectToolInvocationMessageWithProfile = (profileId: string) => {
        return l10n.t({
            message: "Connecting using profile {0}",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    public static disconnectToolConfirmationTitle = l10n.t("Disconnect");
    public static disconnectToolConfirmationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Disconnect from connection '{0}'?",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static disconnectToolInvocationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Disconnecting from connection '{0}'",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static showSchemaToolConfirmationTitle = l10n.t("Show Schema");
    public static showSchemaToolConfirmationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Show schema for connection '{0}'?",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static showSchemaToolInvocationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Showing schema for connection '{0}'",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static noConnectionError = (connectionId: string) => {
        return l10n.t({
            message: "No connection found for connectionId: {0}",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static showSchemaToolSuccessMessage = l10n.t("Schema visualization opened.");
    public static getConnectionDetailsToolConfirmationTitle = l10n.t("Get Connection Details");
    public static getConnectionDetailsToolConfirmationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Get connection details for connection '{0}'?",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static getConnectionDetailsToolInvocationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Getting connection details for connection '{0}'",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static listDatabasesToolConfirmationTitle = l10n.t("List Databases");
    public static listDatabasesToolConfirmationMessage = (connectionId: string) => {
        return l10n.t({
            message: "List databases for connection '{0}'?",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static listDatabasesToolInvocationMessage = (connectionId: string) => {
        return l10n.t({
            message: "Listing databases for connection '{0}'",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static changeDatabaseToolConfirmationTitle = l10n.t("Change Database");
    public static changeDatabaseToolConfirmationMessage = (
        connectionId: string,
        database: string,
    ) => {
        return l10n.t({
            message: "Change database to '{1}' for connection '{0}'?",
            args: [connectionId, database],
            comment: ["{0} is the connection ID", "{1} is the database name"],
        });
    };
    public static changeDatabaseToolInvocationMessage = (
        connectionId: string,
        database: string,
    ) => {
        return l10n.t({
            message: "Changing database to '{1}' for connection '{0}'",
            args: [connectionId, database],
            comment: ["{0} is the connection ID", "{1} is the database name"],
        });
    };
    public static changeDatabaseToolSuccessMessage = (database: string) => {
        return l10n.t({
            message: "Successfully changed to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    public static changeDatabaseToolFailMessage = (database: string) => {
        return l10n.t({
            message: "Failed to connect to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
}

export class QueryEditor {
    public static codeLensConnect = l10n.t("$(plug)  Connect to MSSQL");
}

export class ConnectionGroup {
    public static createNewGroup = l10n.t("Create Connection Group");
    public static editExistingGroup = (groupName: string) => {
        return l10n.t({
            message: "Edit Connection Group - {0}",
            args: [groupName],
            comment: ["{0} is the connection group name"],
        });
    };
}
