/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";

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
export let msgCancelQueryNotRunning = l10n.t(
    "Cannot cancel query as no query is running.",
);
export let msgChooseDatabaseNotConnected = l10n.t(
    "No connection was found. Please connect to a server first.",
);
export let msgChooseDatabasePlaceholder = l10n.t(
    "Choose a database from the list below",
);
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
export function msgConnectionErrorPasswordExpired(
    errorNumber: number,
    errorMessage: string,
) {
    return l10n.t({
        message:
            "Error {0}: {1} Please login as a different user and change the password using ALTER LOGIN.",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
export let connectionErrorChannelName = l10n.t("Connection Errors");
export let msgPromptCancelConnect = l10n.t(
    "Server connection in progress. Do you want to cancel?",
);
export let msgPromptClearRecentConnections = l10n.t(
    "Confirm to clear recent connections list",
);
export let msgOpenSqlFile = l10n.t(
    'To use this command, Open a .sql file -or- Change editor language to "SQL" -or- Select T-SQL text in the active SQL editor.',
);
export let recentConnectionsPlaceholder = l10n.t(
    "Choose a connection profile from the list below",
);
export let CreateProfileFromConnectionsListLabel = l10n.t(
    "Create Connection Profile",
);
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
export let authTypeAzureActiveDirectory = l10n.t(
    "Microsoft Entra Id - Universal w/ MFA Support",
);
export let azureAuthTypeCodeGrant = l10n.t("Azure Code Grant");
export let azureAuthTypeDeviceCode = l10n.t("Azure Device Code");
export let azureLogChannelName = l10n.t("Azure Logs");
export let azureConsentDialogOpen = l10n.t("Open");
export let azureConsentDialogCancel = l10n.t("Cancel");
export let azureConsentDialogIgnore = l10n.t("Ignore Tenant");
export function azureConsentDialogBody(
    tenantName: string,
    tenantId: string,
    resource: string,
) {
    return l10n.t({
        message:
            "Your tenant '{0} ({1})' requires you to re-authenticate again to access {2} resources. Press Open to start the authentication process.",
        args: [tenantName, tenantId, resource],
        comment: [
            "{0} is the tenant name",
            "{1} is the tenant id",
            "{2} is the resource",
        ],
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
        message:
            "Provider '{0}' does not have a Microsoft resource endpoint defined.",
        args: [provider],
        comment: ["{0} is the provider"],
    });
}
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
export let enableTrustServerCertificate = l10n.t(
    "Enable Trust Server Certificate",
);
export let readMore = l10n.t("Read more");
export let cancel = l10n.t("Cancel");
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
export let accountCouldNotBeAdded = l10n.t(
    "New Microsoft Entra account could not be added.",
);
export let accountRemovedSuccessfully = l10n.t(
    "Selected Microsoft Entra account removed successfully.",
);
export function accountRemovalFailed(error: string) {
    return l10n.t({
        message:
            "An error occurred while removing Microsoft Entra account: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
export let noAzureAccountForRemoval = l10n.t(
    "No Microsoft Entra account can be found for removal.",
);
export let clearedAzureTokenCache = l10n.t(
    "Azure token cache cleared successfully.",
);
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
export let msgCannotOpenContent = l10n.t(
    "Error occurred opening content in editor.",
);
export let msgSaveStarted = l10n.t("Started saving results to ");
export let msgSaveFailed = l10n.t("Failed to save results. ");
export let msgSaveSucceeded = l10n.t("Successfully saved results to ");
export let msgSelectProfileToRemove = l10n.t("Select profile to remove");
export let confirmRemoveProfilePrompt = l10n.t(
    "Confirm to remove this profile.",
);
export let msgNoProfilesSaved = l10n.t("No connection profile to remove.");
export let msgProfileRemoved = l10n.t("Profile removed successfully");
export let msgProfileCreated = l10n.t("Profile created successfully");
export let msgProfileCreatedAndConnected = l10n.t(
    "Profile created and connected",
);
export let msgClearedRecentConnections = l10n.t(
    "Recent connections list cleared",
);
export let msgIsRequired = l10n.t(" is required.");
export let msgError = l10n.t("Error: ");
export let msgYes = l10n.t("Yes");
export let msgNo = l10n.t("No");
export let defaultDatabaseLabel = l10n.t("<default>");
export let notConnectedLabel = l10n.t("Disconnected");
export let notConnectedTooltip = l10n.t("Click to connect to a database");
export let connectingLabel = l10n.t("Connecting");
export let connectingTooltip = l10n.t("Connecting to: ");
export let connectErrorLabel = l10n.t("Connection error");
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
export function msgChangedDatabaseContext(
    databaseName: string,
    documentName: string,
) {
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
export function msgPromptRetryFirewallRuleSignedIn(
    clientIp: string,
    serverName: string,
) {
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
export let msgUnableToExpand = l10n.t(
    "Unable to expand. Please check logs for more information.",
);
export let msgPromptFirewallRuleCreated = l10n.t(
    "Firewall rule successfully created.",
);
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
        args: [connectionId],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export let msgRefreshTokenError = l10n.t("Error when refreshing token");
export let msgAzureCredStoreSaveFailedError = l10n.t(
    'Keys for token cache could not be saved in credential store, this may cause Microsoft Entra Id access token persistence issues and connection instabilities. It\'s likely that SqlTools has reached credential storage limit on Windows, please clear at least 2 credentials that start with "Microsoft.SqlTools|" in Windows Credential Manager and reload.',
);
export function msgRefreshConnection(connectionId: string, uri: string) {
    return l10n.t({
        message:
            "Failed to refresh connection ${0} with uri {1}, invalid connection result.",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
export function msgRefreshTokenSuccess(
    connectionId: string,
    uri: string,
    message: string,
) {
    return l10n.t({
        message:
            "Successfully refreshed token for connection {0} with uri {1}, {2}",
        args: [connectionId, uri, message],
        comment: [
            "{0} is the connection id",
            "{1} is the uri",
            "{2} is the message",
        ],
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
        message:
            'Connected to server "{0}" on document "{1}". Server information: {2}',
        args: [serverName, documentName, serverInfo],
        comment: [
            "{0} is the server name",
            "{1} is the document name",
            "{2} is the server info",
        ],
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
        message:
            'Changing database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: [
            "{0} is the database name",
            "{1} is the server name",
            "{2} is the document name",
        ],
    });
}
export function msgChangedDatabase(
    databaseName: string,
    serverName: string,
    documentName: string,
) {
    return l10n.t({
        message:
            'Changed database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: [
            "{0} is the database name",
            "{1} is the server name",
            "{2} is the document name",
        ],
    });
}
export function msgDisconnected(documentName: string) {
    return l10n.t({
        message: 'Disconnected on document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
export let macOpenSslErrorMessage = l10n.t(
    "OpenSSL version >=1.0.1 is required to connect.",
);
export let macOpenSslHelpButton = l10n.t("Help");
export let macSierraRequiredErrorMessage = l10n.t(
    "macOS Sierra or newer is required to use this feature.",
);
export let gettingDefinitionMessage = l10n.t("Getting definition ...");
export let definitionRequestedStatus = l10n.t("DefinitionRequested");
export let definitionRequestCompletedStatus = l10n.t(
    "DefinitionRequestCompleted",
);
export let updatingIntelliSenseStatus = l10n.t("updatingIntelliSense");
export let intelliSenseUpdatedStatus = l10n.t("intelliSenseUpdated");
export let testLocalizationConstant = l10n.t("test");
export let disconnectOptionLabel = l10n.t("Disconnect");
export let disconnectOptionDescription = l10n.t("Close the current connection");
export let disconnectConfirmationMsg = l10n.t(
    "Are you sure you want to disconnect?",
);
export function elapsedBatchTime(batchTime: string) {
    return l10n.t({
        message: "Batch execution time: {0}",
        args: [batchTime],
        comment: ["{0} is the batch time"],
    });
}
export let noActiveEditorMsg = l10n.t(
    "A SQL editor must have focus before executing this command",
);
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
export let msgAddConnection = l10n.t("Add Connection");
export let msgConnect = l10n.t("Connect");
export let azureSignIn = l10n.t("Azure: Sign In");
export let azureSignInDescription = l10n.t(
    "Sign in to your Azure subscription",
);
export let azureSignInWithDeviceCode = l10n.t(
    "Azure: Sign In with Device Code",
);
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
export function taskStatusWithNameAndMessage(
    taskName: string,
    status: string,
    message: string,
) {
    return l10n.t({
        message: "{0}: {1}. {2}",
        args: [taskName, status, message],
        comment: [
            "{0} is the task name",
            "{1} is the status",
            "{2} is the message",
        ],
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
export let connectProgressNoticationTitle = l10n.t(
    "Testing connection profile...",
);
export let msgMultipleSelectionModeNotSupported = l10n.t(
    "Running query is not supported when the editor is in multiple selection mode.",
);
export let newColumnWidthPrompt = l10n.t("Enter new column width");
export let columnWidthInvalidNumberError = l10n.t("Invalid column width");
export let columnWidthMustBePositiveError = l10n.t(
    "Width cannot be 0 or negative",
);
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

export function enableRichExperiencesPrompt(learnMoreUrl: string) {
    return l10n.t({
        message:
            "The MSSQL for VS Code extension is introducing new modern data development features! Would you like to enable them? [Learn more]({0})",
        args: [learnMoreUrl],
        comment: ["{0} is a url to learn more about the new features"],
    });
}
export let enableRichExperiences = l10n.t("Enable Experiences & Reload");

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
    public static serverIsRequired = l10n.t("Server is required");
    public static usernameIsRequired = l10n.t("User name is required");
    public static connectionString = l10n.t("Connection String");
    public static connectionStringIsRequired = l10n.t(
        "Connection string is required",
    );
    public static signIn = l10n.t("Sign in");
    public static additionalParameters = l10n.t("Additional parameters");
    public static connect = l10n.t("Connect");

    public static errorLoadingAzureDatabases(
        subscriptionName: string,
        subscriptionId: string,
    ) {
        return l10n.t({
            message:
                "Error loading Azure databases for subscription {0} ({1}).  Confirm that you have permission.",
            args: [subscriptionName, subscriptionId],
            comment: [
                "{0} is the subscription name",
                "{1} is the subscription id",
            ],
        });
    }
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
    public static remindMeLater = l10n.t("Remind Me Later");
    public static dontShowAgain = l10n.t("Don't Show Again");
    public static doYouMindTakingAQuickFeedbackSurvey = l10n.t(
        "Do you mind taking a quick feedback survey about the MSSQL Extension for VS Code?",
    );
    public static mssqlFeedback = l10n.t("MSSQL Feedback");
    public static privacyDisclaimer = l10n.t(
        "Microsoft reviews your feedback to improve our products, so don't share any personal data or confidential/proprietary content.",
    );
    public static overallHowStatisfiedAreYouWithFeature = (
        featureName: string,
    ) =>
        l10n.t({
            message: "Overall, how satisfied are you with {0}?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });

    public static howLikelyAreYouToRecommendFeature = (featureName: string) =>
        l10n.t({
            message:
                "How likely it is that you would recommend {0} to a friend or colleague?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });
}

export class Common {
    public static remindMeLater = l10n.t("Remind Me Later");
    public static dontShowAgain = l10n.t("Don't Show Again");
    public static learnMore = l10n.t("Learn More");
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
