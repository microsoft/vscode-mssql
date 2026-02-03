/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from "vscode";
import * as os from "os";

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
    public static publicString = l10n.t("Public");
    public static privateString = l10n.t("Private");
}

export let createDatabaseDialogTitle = l10n.t("Create Database");
export let dropDatabaseDialogTitle = l10n.t("Drop Database");
export let renameDatabaseDialogTitle = l10n.t("Rename Database");
export let renameDatabaseInputPlaceholder = l10n.t("Enter the new database name");
export let databaseNameRequired = l10n.t("Database name is required");
export let msgSelectServerNodeToCreateDatabase = l10n.t(
    "Please select a server node in Object Explorer to create a database.",
);
export let msgSelectDatabaseNodeToDrop = l10n.t(
    "Please select a database node in Object Explorer to drop.",
);
export let msgSelectDatabaseNodeToRename = l10n.t(
    "Please select a database node in Object Explorer to rename.",
);
export function createDatabaseError(databaseName: string, errorMessage: string) {
    return l10n.t({
        message: "Failed to create database '{0}'. {1}",
        args: [databaseName, errorMessage],
        comment: ["{0} is the database name", "{1} is the error message"],
    });
}
export function dropDatabaseError(databaseName: string, errorMessage: string) {
    return l10n.t({
        message: "Failed to drop database '{0}'. {1}",
        args: [databaseName, errorMessage],
        comment: ["{0} is the database name", "{1} is the error message"],
    });
}
export function renameDatabaseError(
    databaseName: string,
    newDatabaseName: string,
    errorMessage: string,
) {
    return l10n.t({
        message: "Failed to rename database '{0}' to '{1}'. {2}",
        args: [databaseName, newDatabaseName, errorMessage],
        comment: [
            "{0} is the current database name",
            "{1} is the new database name",
            "{2} is the error message",
        ],
    });
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
export let help = l10n.t("Help");
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
export let msgSelectNodeToScript = l10n.t("Please select a node from Object Explorer to script.");
export let msgSelectSingleNodeToScript = l10n.t(
    "Please select only one node to script. Multiple node scripting is not supported.",
);
export function msgScriptingObjectNotFound(nodeType: string, nodeLabel: string): string {
    return l10n.t({
        message: "Could not find scripting metadata for {0} '{1}'.",
        args: [nodeType, nodeLabel],
        comment: ["{0} is the node type", "{1} is the node label"],
    });
}
export let msgScriptingFailed = l10n.t(
    "Failed to generate script. Please check the logs for more details.",
);
export let msgScriptingEditorFailed = l10n.t("Failed to open script in editor.");
export let msgNoScriptGenerated = l10n.t("No script generated.");
export let msgObjectManagementUnknownDialog = l10n.t("Unknown object management dialog.");
export function msgScriptingOperationFailed(error: string): string {
    return l10n.t({
        message: "Failed to generate script: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
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
export let searchObjectsPlaceholder = l10n.t("Search for database objects...");
export let searchObjectsPrompt = l10n.t("Enter part of an object name to search for");
export function searchObjectsNoResultsMessage(term: string) {
    return l10n.t({
        message: "No database objects found matching '{0}'",
        args: [term],
        comment: ["{0} is the search term"],
    });
}
export let searchObjectsError = l10n.t("An error occurred while searching database objects");
export function searchObjectsErrorWithDetail(detail: string) {
    return l10n.t({
        message: "An error occurred while searching database objects: {0}",
        args: [detail],
        comment: ["{0} is the error detail returned from the search operation"],
    });
}
export let searchObjectsNoConnection = l10n.t(
    "No active database connection. Please connect to a database first.",
);
export function searchObjectsSelectPrompt(count: string | number) {
    return l10n.t({
        message: "Select an object to view its definition ({0} results)",
        args: [count],
        comment: ["{0} is the number of results"],
    });
}
export let searchObjectsInvalidConnectionUri = l10n.t(
    "Invalid connection URI. Please ensure you have an active database connection.",
);
export let queryFailed = l10n.t("Query failed");

export let parameters = l10n.t("Parameters");
export let loading = l10n.t("Loading");
export let executionPlan = l10n.t("Execution Plan");
export let executionPlanFileFilter = l10n.t("SQL Plan Files");
export let scriptCopiedToClipboard = l10n.t("Script copied to clipboard");
export let copied = l10n.t("Copied");
export let copyingResults = l10n.t("Copying results...");
export let resultsCopiedToClipboard = l10n.t("Results copied to clipboard");

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
export let newDeployment = l10n.t("New Deployment");

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
    public static GeneratingScript = l10n.t("Generating script...");
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
    public static ConnectionStringCopied = l10n.t("Connection string copied to clipboard");
}

export class ConnectionDialog {
    public static connectionDialog = l10n.t("Connection Dialog");
    public static microsoftAccount = l10n.t("Microsoft Account");
    public static microsoftAccountIsRequired = l10n.t("Microsoft Account is required");
    public static selectAnAccount = l10n.t("Select an account");
    public static addAccount = l10n.t("Add account");
    public static savePassword = l10n.t("Save Password");
    public static tenantId = l10n.t("Tenant ID");
    public static selectATenant = l10n.t("Select a tenant");
    public static tenantIdIsRequired = l10n.t("Tenant ID is required");
    public static profileName = l10n.t("Profile Name");
    public static profileNamePlaceholder = l10n.t("Enter profile name");
    public static profileNameTooltip = l10n.t(
        "[Optional] Enter a display name for this connection profile",
    );
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
    public static clearCacheAndRefreshToken = l10n.t("Clear cache and refresh token");
    public static clearTokenCache = l10n.t("Clear token cache");

    public static noWorkspacesFound = l10n.t(
        "No workspaces found. Please change Fabric account or tenant to view available workspaces.",
    );

    public static unsupportedAuthType(authenticationType: string) {
        return l10n.t({
            message:
                "Unsupported authentication type in connection string: {0}. Only SQL Login, Integrated, and Azure MFA authentication are supported.",
            args: [authenticationType],
            comment: ["{0} is the authentication type"],
        });
    }
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
    public static errorSigningIntoAzure(arg0: string): string {
        return l10n.t({
            message: "Error signing into Azure: {0}",
            args: [arg0],
            comment: ["{0} is the error message"],
        });
    }

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

    public static failedToGetTenantForAccount = (tenantId: string, accountName: string) => {
        return l10n.t({
            message: "Failed to get tenant '{0}' for account '{1}'.",
            args: [tenantId, accountName],
            comment: ["{0} is the tenant id", "{1} is the account name"],
        });
    };

    public static PublicCloud = l10n.t("Azure (Public)");
    public static USGovernmentCloud = l10n.t("Azure (US Government)");
    public static ChinaCloud = l10n.t("Azure (China)");

    public static customCloudNotConfigured = (missingSetting: string) => {
        return l10n.t(
            "The custom cloud choice is not configured. Please configure the setting `{0}`.",
            missingSetting,
        );
    };
}

export class Fabric {
    public static failedToGetWorkspacesForTenant = (
        tenantName: string,
        tenantId: string,
        errorMessage?: string,
    ) => {
        if (errorMessage) {
            return l10n.t({
                message: "Failed to get Fabric workspaces for tenant '{0} ({1})': {2}",
                args: [tenantName, tenantId, errorMessage],
                comment: [
                    "{0} is the tenant name",
                    "{1} is the tenant id",
                    "{2} is the error message",
                ],
            });
        } else {
            return l10n.t({
                message: "Failed to get Fabric workspaces for tenant '{0} ({1})'.",
                args: [tenantName, tenantId],
                comment: ["{0} is the tenant name", "{1} is the tenant id"],
            });
        }
    };

    public static listingCapacitiesForTenant = (tenantId: string) => {
        return l10n.t({
            message: "Listing Fabric capacities for tenant '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };

    public static listingWorkspacesForTenant = (tenantId: string) => {
        return l10n.t({
            message: "Listing Fabric workspaces for tenant '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };

    public static gettingWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Getting Fabric workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingSqlDatabasesForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing Fabric SQL Databases for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingSqlEndpointsForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing Fabric SQL Endpoints for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static gettingConnectionStringForSqlEndpoint = (
        sqlEndpointId: string,
        workspaceId: string,
    ) => {
        return l10n.t({
            message: "Getting connection string for SQL Endpoint '{0}' in workspace '{1}'",
            args: [sqlEndpointId, workspaceId],
            comment: ["{0} is the SQL endpoint ID", "{1} is the workspace ID"],
        });
    };

    public static createWorkspaceWithCapacity = (capacityId: string) => {
        return l10n.t({
            message: "Creating workspace with capacity {0}",
            args: [capacityId],
            comment: ["{0} is the capacity ID"],
        });
    };

    public static createSqlDatabaseForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Creating SQL Database for workspace {0}",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static listingRoleAssignmentsForWorkspace = (workspaceId: string) => {
        return l10n.t({
            message: "Listing role assignments for workspace '${workspaceId}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };

    public static gettingFabricDatabase = (databaseId: string) => {
        return l10n.t({
            message: "Getting Fabric database '{0}'",
            args: [databaseId],
            comment: ["{0} is the database ID"],
        });
    };

    public static fabricApiError = (resultCode: string, resultMessage: string) => {
        return l10n.t({
            message: "Fabric API error occurred ({0}): {1}",
            args: [resultCode, resultMessage],
            comment: ["{0} is the error code", "{1} is the error message"],
        });
    };

    public static fabricLongRunningApiError = (resultCode: string, error: string) => {
        return l10n.t({
            message: "Fabric long-running API error with error code '{0}': {1}",
            args: [resultCode, error],
            comment: ["{0} is the error code", "{1} is the error message"],
        });
    };

    public static fabricAccount = l10n.t("Fabric Account");
    public static fabricAccountIsRequired = l10n.t("Fabric Account is required");
    public static workspace = l10n.t("Workspace");
    public static selectAWorkspace = l10n.t("Select a Workspace");
    public static searchWorkspaces = l10n.t("Search Workspaces");
    public static workspaceIsRequired = l10n.t("Workspace is required");
    public static insufficientWorkspacePermissions = l10n.t("Insufficient Workspace Permissions");

    public static fabricNotSupportedInCloud = (cloudName: string, settingName: string) => {
        return l10n.t({
            message:
                "Fabric is not supported in the current cloud ({0}).  Ensure setting '{1}' is configured correctly.",
            args: [cloudName, settingName],
            comment: ["{0} is the cloud name", "{1} is the setting name"],
        });
    };
}

export class Accounts {
    public static invalidEntraAccountsRemoved = (numRemoved: number) => {
        return l10n.t({
            message:
                "{0} invalid Entra accounts have been removed; you may need to run `MS SQL: Clear Microsoft Entra account token cache` and log in again.",
            args: [numRemoved],
            comment: ["{0} is the number of invalid accounts that have been removed"],
        });
    };
    public static clearedEntraTokenCache = l10n.t("Entra token cache cleared successfully.");
}

export class FabricProvisioning {
    public static databaseName = l10n.t("Database Name");
    public static enterDatabaseName = l10n.t("Enter Database Name");
    public static databaseNameIsRequired = l10n.t("Database Name is required");
    public static databaseDescription = l10n.t("Database Description");
    public static enterDatabaseDescription = l10n.t("Enter Database Description");
    public static workspacePermissionsError = l10n.t(
        "Please select a workspace where you have sufficient permissions (Contributor or higher)",
    );
    public static databaseNameError = l10n.t(
        "This database name is already in use. Please choose a different name.",
    );
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
    ) => {
        return [
            l10n.t({
                message: "Average: {0}",
                args: [average],
                comment: ["{0} is the average"],
            }),
            l10n.t({
                message: "Count: {0}",
                args: [count],
                comment: ["{0} is the count"],
            }),
            l10n.t({
                message: "Distinct Count: {0}",
                args: [distinctCount],
                comment: ["{0} is the distinct count"],
            }),
            l10n.t({
                message: "Max: {0}",
                args: [max],
                comment: ["{0} is the max"],
            }),
            l10n.t({
                message: "Min: {0}",
                args: [min],
                comment: ["{0} is the min"],
            }),
            l10n.t({
                message: "Null Count: {0}",
                args: [nullCount],
                comment: ["{0} is the null count"],
            }),
            l10n.t({
                message: "Sum: {0}",
                args: [sum],
                comment: ["{0} is the sum"],
            }),
        ].join(os.EOL);
    };
    public static nonNumericSelectionSummaryTooltip = (
        count: number,
        distinctCount: number,
        nullCount: number,
    ) => {
        return [
            l10n.t({
                message: "Count: {0}",
                args: [count],
                comment: ["{0} is the count"],
            }),
            l10n.t({
                message: "Distinct Count: {0}",
                args: [distinctCount],
                comment: ["{0} is the distinct count"],
            }),
            l10n.t({
                message: "Null Count: {0}",
                args: [nullCount],
                comment: ["{0} is the null count"],
            }),
        ].join(os.EOL);
    };
    public static copyError = (error: string) =>
        l10n.t({
            message: "An error occurred while copying results: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static summaryFetchConfirmation = (numRows: number) =>
        l10n.t({
            message: "{0} rows selected, click to load summary",
            args: [numRows],
            comment: ["{0} is the number of rows to fetch summary statistics for"],
        });
    public static clickToFetchSummary = l10n.t("Click to load summary");
    public static summaryLoadingProgress = (totalRows: number) => {
        return l10n.t({
            message: `Loading summary for {0} rows (Click to cancel)`,
            args: [totalRows],
            comment: ["{0} is the total number of rows"],
        });
    };
    public static clickToCancelLoadingSummary = l10n.t("Click to cancel loading summary");
    public static summaryLoadingCanceled = l10n.t("Summary loading canceled");
    public static summaryLoadingCanceledTooltip = l10n.t("Summary loading was canceled by user");
    public static errorLoadingSummary = l10n.t("Error loading summary");
    public static errorLoadingSummaryTooltip = (error: string) =>
        l10n.t({
            message: "Error loading summary: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    public static getRowsError = (error: string) =>
        l10n.t({
            message: "An error occurred while retrieving rows: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
}

export class LocalContainers {
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
    public static pullImageHeader = l10n.t("Pulling SQL Server Image");
    public static pullImageBody = l10n.t(
        "Pulling the SQL Server container image. This might take a few minutes depending on your internet connection.",
    );

    public static creatingContainerHeader = l10n.t("Creating Container");
    public static creatingContainerBody = l10n.t("Creating and starting your SQL Server container");
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
    public static pullSqlServerContainerImageError = l10n.t(
        "Failed to pull SQL Server image. Please check your network connection and try again.",
    );
    public static unsupportedDockerPlatformError = (platform: string) =>
        l10n.t({
            message: "Unsupported platform for Docker: {0}",
            args: [platform],
            comment: ["{0} is the platform name of the machine"],
        });
    public static unsupportedDockerArchitectureError = (architecture: string) =>
        l10n.t({
            message: "Unsupported architecture for Docker: {0}",
            args: [architecture],
            comment: ["{0} is the architecture name of the machine"],
        });
    public static rosettaError = l10n.t(
        'Rosetta is required to run SQL Server container images on Apple Silicon. Enable "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" in Docker Desktop > Settings > General.',
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
    public static startingDockerLoadingLabel = l10n.t("Starting Docker...");
    public static startingContainerLoadingLabel = l10n.t("Starting Container...");
    public static readyingContainerLoadingLabel = l10n.t("Readying container for connections...");
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
    public static configureRosetta = l10n.t("Configure Rosetta in Docker Desktop");
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
    public static passwordPlaceholder = l10n.t("Enter password");
    public static containerNamePlaceholder = l10n.t("Enter container name");
    public static portPlaceholder = l10n.t("Enter port");
    public static hostnamePlaceholder = l10n.t("Enter hostname");
    public static sqlServer2025ArmError = l10n.t(
        "SQL Server 2025 is not supported on ARM architecture. Please select a different SQL Server version.",
    );
    public static sqlServer2025ArmErrorTooltip = l10n.t(
        "SQL Server 2025 is not yet supported on ARM architecture. ARM support will be available starting with the SQL Server 2025 CU1 container image.",
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

export class PublishProject {
    public static Title = l10n.t("Publish Project (Preview)");
    public static PublishProfileLabel = l10n.t("Publish Profile");
    public static PublishProfilePlaceholder = l10n.t("Load profile...");
    public static SelectPublishProfile = l10n.t("Select Profile");
    public static SaveAs = l10n.t("Save As");
    public static PublishSettingsFile = l10n.t("Publish Settings File");
    public static ServerLabel = l10n.t("Server");
    public static DatabaseLabel = l10n.t("Database");
    public static DatabaseRequiredMessage = l10n.t("Database name is required");
    public static SqlCmdVariablesLabel = l10n.t("SQLCMD Variables");
    public static PublishTargetLabel = l10n.t("Publish Target");
    public static PublishTargetExisting = l10n.t("Existing SQL Server");
    public static PublishTargetContainer = l10n.t("New Local Docker SQL Server");
    public static PublishTargetNewAzureServer = l10n.t("New Azure SQL logical server (Preview)");
    public static GenerateScript = l10n.t("Generate Script");
    public static Publish = l10n.t("Publish");
    public static BuildProjectTaskLabel(projectName: string) {
        return l10n.t("Build {0}", projectName);
    }
    public static BuildingProjectProgress(projectName: string) {
        return l10n.t("Building {0}...", projectName);
    }
    public static BuildFailedWithExitCode(exitCode: number) {
        return l10n.t("Build failed with exit code {0}", exitCode);
    }
    public static SqlServerPortNumber = l10n.t("SQL Server port number");
    public static SqlServerAdminPassword = l10n.t("SQL Server admin password");
    public static SqlServerAdminPasswordConfirm = l10n.t("Confirm SQL Server admin password");
    public static SqlServerImageTag = l10n.t("Image tag");
    public static SqlServerLicenseAgreement = l10n.t("Microsoft SQL Server License Agreement");
    public static ServerConnectionPlaceholder = l10n.t("Select Connection");
    public static CheckingDockerPrerequisites = l10n.t("Checking Docker prerequisites...");
    public static CreatingSqlServerContainer = l10n.t("Creating SQL Server container...");
    // Validation messages
    public static InvalidPortMessage = l10n.t("Port must be a number between 1 and 65535");
    public static InvalidSQLPasswordMessage(name: string) {
        return l10n.t(
            "Invalid SQL Server password for {0}. Password must be 8–128 characters long and meet the complexity requirements.  For more information see https://docs.microsoft.com/sql/relational-databases/security/password-policy",
            name,
        );
    }
    public static PasswordNotMatchMessage = (name: string) => {
        return l10n.t("{0} password doesn't match the confirmation password", name);
    };
    public static RequiredFieldMessage = l10n.t("Required");
    public static LicenseAcceptanceMessage = l10n.t("You must accept the license");
    public static PublishProfileLoadFailed = l10n.t("Failed to load publish profile");
    public static PublishProfileSavedSuccessfully = (path: string) => {
        return l10n.t("Publish profile saved to: {0}", path);
    };
    public static PublishProfileSaveFailed = l10n.t("Failed to save publish profile");
    public static DacFxServiceNotAvailable = l10n.t(
        "DacFx service is not available. Publish and generate script operations cannot be performed.",
    );
    public static DacFxServiceNotAvailableProfileLoaded = l10n.t(
        "DacFx service is not available. Profile loaded without deployment options. Publish and generate script operations cannot be performed.",
    );
    public static FailedToListDatabases = l10n.t("Failed to list databases");
    public static FailedToConnectToServer = l10n.t("Failed to connect to server");
    public static ConnectionProfileNotFound = l10n.t(
        "Connection profile not found. Please create a new connection using the Connection Dialog.",
    );
    public static FailedToFetchContainerTags = (errorMessage: string) => {
        return l10n.t("Failed to fetch Docker container tags: {0}", errorMessage);
    };
    public static ProfileLoadedConnectionFailed = (serverName: string) =>
        l10n.t({
            message:
                "Profile loaded, but the connection could not be automatically established. Please create a connection to {0} then try again.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    public static FailedToGenerateSqlPackageCommand(errorMessage: string) {
        return l10n.t("Failed to generate SqlPackage command: {0}", errorMessage);
    }
    public static FailedToGetConnectionString(errorMessage: string) {
        return l10n.t("Failed to get connection string: {0}", errorMessage);
    }
    public static NoActiveConnection = l10n.t("No active connection");
    public static DacpacPathNotFound = l10n.t(
        "DACPAC path not found. Please build the project first.",
    );
}

export class SchemaCompare {
    public static Title = l10n.t("Schema Compare");
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
    public static connectionFailed = (errorMessage: string) =>
        l10n.t({
            message: "Connection failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message from the connection attempt"],
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
    public static connectingToProfile = (profileName: string) => {
        return l10n.t({
            message: "Connecting to {0}...",
            args: [profileName],
            comment: ["{0} is the connection display name"],
        });
    };

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

    public static orphanedConnectionGroupsWarning = (groupNames: string) => {
        return l10n.t({
            message:
                "One or more connection groups reference parent groups that do not exist and have been ignored: {0}. Update your settings file to fix these entries.",
            args: [groupNames],
            comment: ["{0} is the comma separated list of connection group names"],
        });
    };

    public static orphanedConnectionsWarning = (connectionDisplayNames: string[]) => {
        return l10n.t({
            message:
                "One or more connections reference groups that do not exist and have been ignored: {0}. Update your connection settings to fix these entries.",
            args: [connectionDisplayNames.join(", ")],
            comment: ["{0} is the comma separated list of connection display names"],
        });
    };

    public static multipleRootGroupsFoundError = (rootId: string) => {
        return l10n.t({
            message:
                "Multiple connection groups with ID '{0}' found.  Delete or rename all of them, except one in User/Global settings.json, then restart the extension.",
            args: [rootId],
            comment: ["{0} is the root id"],
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
    public static noAccountSelected = l10n.t("No account selected");
    public static currentAccount = (accountDisplayName: string) => {
        return l10n.t({
            message: "{0} (Current Account)",
            args: [accountDisplayName],
            comment: ["{0} is the account display name"],
        });
    };
    public static signInToAzure = l10n.t("Sign in to a new account");
    public static SelectAccountForKeyVault = l10n.t(
        "Select Azure account with Key Vault access for column decryption",
    );
    public static NoTenantSelected = l10n.t("No tenant selected");
    public static SelectTenant = l10n.t("Select a tenant");

    public static ChangePassword = l10n.t("Change Password");
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
    public static messageCouldNotBeProcessed = l10n.t(
        "This message couldn't be processed. If this issue persists, please check the logs and open an issue on GitHub.",
    );
    public static connect = l10n.t("Connect");
    public static openSqlEditorAndConnect = l10n.t("Open SQL editor and connect");
    public static connectionRequiredMessage = (buttonText: string) => {
        return l10n.t({
            message:
                'An active connection is required for GitHub Copilot to understand your database schema and proceed.\nSelect "{0}" to establish a connection.',
            args: [buttonText],
            comment: ["{0} is the button text (e.g., 'Connect' or 'Open SQL editor and connect')"],
        });
    };
    // Follow-up questions
    public static followUpConnectToDatabase = l10n.t("Connect to a database");
    public static followUpShowRandomTableDefinition = l10n.t("Show a random table definition");
    public static followUpCountTables = l10n.t("How many tables are in this database?");
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
    public static disconnectToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Disconnect from connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static disconnectToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Disconnecting from connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static showSchemaToolConfirmationTitle = l10n.t("Show Schema");
    public static showSchemaToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Show schema for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static showSchemaToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Showing schema for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static noConnectionError = (connectionId: string) => {
        return l10n.t({
            message: "No connection found for connectionId: {0}",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    public static unknownConnection = l10n.t("Unknown Connection");
    public static showSchemaToolSuccessMessage = l10n.t("Schema visualization opened.");
    public static schemaDesignerToolConfirmationTitle = l10n.t("Schema Designer");
    public static schemaDesignerToolConfirmationMessage = (operation: string) => {
        return l10n.t({
            message: "Execute '{0}' operation on the schema designer?",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static schemaDesignerToolInvocationMessage = (operation: string) => {
        return l10n.t({
            message: "Executing '{0}' operation on schema designer",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static schemaDesignerNoActiveDesigner = l10n.t(
        "No active schema designer found. Please open a schema designer first using /showSchema or from the UI.",
    );
    public static schemaDesignerStaleState = l10n.t(
        "Schema designer state changed. Fetch the latest schema and retry the operation.",
    );
    public static schemaDesignerMissingConnectionId = l10n.t(
        "Missing connectionId. Please provide a connectionId to open the schema designer.",
    );
    public static schemaDesignerAddTableSuccess = l10n.t(
        "Table added to schema designer successfully.",
    );
    public static schemaDesignerAddTableFailed = l10n.t("Failed to add table to schema designer.");
    public static schemaDesignerUpdateTableSuccess = l10n.t(
        "Table updated in schema designer successfully.",
    );
    public static schemaDesignerUpdateTableFailed = l10n.t(
        "Failed to update table in schema designer.",
    );
    public static schemaDesignerDeleteTableSuccess = l10n.t(
        "Table deleted from schema designer successfully.",
    );
    public static schemaDesignerDeleteTableFailed = l10n.t(
        "Failed to delete table from schema designer.",
    );
    public static schemaDesignerReplaceSchemaSuccess = l10n.t(
        "Schema designer updated successfully.",
    );
    public static schemaDesignerReplaceSchemaFailed = l10n.t("Failed to update schema designer.");
    public static schemaDesignerGetSchemaSuccess = l10n.t(
        "Schema designer state retrieved successfully.",
    );
    public static schemaDesignerMissingSchema = l10n.t(
        "Missing schema payload for replace_schema operation.",
    );
    public static schemaDesignerMissingTable = l10n.t(
        "Missing table payload for update_table operation.",
    );
    public static schemaDesignerMissingDeleteTableTarget = l10n.t(
        "Missing table target for delete_table operation. Provide tableId or tableName+schemaName.",
    );
    public static schemaDesignerUnknownOperation = (operation: string) => {
        return l10n.t({
            message:
                "Unknown operation: {0}. Supported operations: add_table, update_table, delete_table, replace_schema, get_schema",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    public static getConnectionDetailsToolConfirmationTitle = l10n.t("Get Connection Details");
    public static getConnectionDetailsToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Get connection details for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static getConnectionDetailsToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Getting connection details for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static listDatabasesToolConfirmationTitle = l10n.t("List Databases");
    public static listDatabasesToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List databases for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static listDatabasesToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Listing databases for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static changeDatabaseToolConfirmationTitle = l10n.t("Change Database");
    public static changeDatabaseToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
        database: string,
    ) => {
        return l10n.t({
            message: "Change database to '{2}' for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId, database],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the database name",
            ],
        });
    };
    public static changeDatabaseToolInvocationMessage = (
        displayName: string,
        connectionId: string,
        database: string,
    ) => {
        return l10n.t({
            message: "Changing database to '{2}' for connection '{0}' (ID: {1})",
            args: [displayName, connectionId, database],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the database name",
            ],
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
    public static ListTablesToolConfirmationTitle = l10n.t("List Tables");
    public static ListTablesToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List tables for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListTablesToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Listing tables for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListSchemasToolConfirmationTitle = l10n.t("List Schemas");
    public static ListSchemasToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List schemas for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListSchemasToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Listing schemas for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListViewsToolConfirmationTitle = l10n.t("List Views");
    public static ListViewsToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List views for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListViewsToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Listing views for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListFunctionsToolConfirmationTitle = l10n.t("List Functions");
    public static ListFunctionsToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "List functions for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static ListFunctionsToolInvocationMessage = (
        displayName: string,
        connectionId: string,
    ) => {
        return l10n.t({
            message: "Listing functions for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    public static RunQueryToolConfirmationTitle = l10n.t("Run Query");
    public static RunQueryToolConfirmationMessage = (
        displayName: string,
        connectionId: string,
        query: string,
    ) => {
        return l10n.t({
            message: "Run query on connection '{0}' (ID: {1})?\n\nQuery: {2}",
            args: [displayName, connectionId, query],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the SQL query",
            ],
        });
    };
    public static RunQueryToolInvocationMessage = (displayName: string, connectionId: string) => {
        return l10n.t({
            message: "Running query on connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };

    // Chat Commands localization strings
    public static connectedSuccessfully = l10n.t("Connected successfully");
    public static failedToConnect = l10n.t("Failed to connect");
    public static disconnectedSuccessfully = l10n.t("Disconnected successfully");
    public static databaseChangedSuccessfully = l10n.t("Database changed successfully");
    public static failedToChangeDatabase = l10n.t("Failed to change database");
    public static noActiveConnectionForDatabaseChange = l10n.t(
        "No active connection for database change",
    );
    public static connectionDetails = l10n.t("Connection Details");
    public static serverLabel = l10n.t("Server");
    public static databaseLabel = l10n.t("Database");
    public static authentication = l10n.t("Authentication");
    public static sqlLogin = l10n.t("SQL Login");
    public static serverVersion = l10n.t("Server Version");
    public static serverEdition = l10n.t("Server Edition");
    public static cloud = l10n.t("Cloud");
    public static yes = l10n.t("Yes");
    public static no = l10n.t("No");
    public static user = l10n.t("User");
    public static noConnectionInformationFound = l10n.t("No connection information found");
    public static noActiveConnection = l10n.t("No active connection");
    public static openingSchemaDesigner = l10n.t("Opening schema designer...");
    public static noConnectionCredentialsFound = l10n.t("No connection credentials found");
    public static noActiveConnectionForSchemaView = l10n.t("No active connection for schema view");
    public static availableServers = l10n.t("Available Servers");
    public static noSavedConnectionProfilesFound = l10n.t("No saved connection profiles found.");
    public static useConnectToCreateNewConnection = (connectCommand: string) => {
        return l10n.t({
            message: "Use {0} to create a new connection.",
            args: [connectCommand],
            comment: ["{0} is the connect command"],
        });
    };
    public static unnamedProfile = l10n.t("Unnamed Profile");
    public static default = l10n.t("Default");
    public static foundSavedConnectionProfiles = (count: number) => {
        return l10n.t({
            message: "Found {0} saved connection profile(s).",
            args: [count],
            comment: ["{0} is the number of connection profiles"],
        });
    };
    public static errorRetrievingServerList = (errorMessage: string) => {
        return l10n.t({
            message: "Error retrieving server list: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    public static unknownError = l10n.t("Unknown error");
    public static noActiveDatabaseConnection = l10n.t(
        "No active database connection in the current editor. Please establish a connection to continue.",
    );
    public static chatCommandNotAvailable = l10n.t(
        "Chat command not available in this VS Code version",
    );

    // Help command strings
    public static helpWelcome = l10n.t(
        "👋 I'm GitHub Copilot for MSSQL extension, your intelligent SQL development assistant in Visual Studio Code. I help you connect, explore, design, and evolve your SQL databases directly from VS Code.",
    );
    public static helpWhatICanDo = l10n.t("What I can do for you:");
    public static helpCapabilityExploreDesign = l10n.t(
        "Explore, design, and evolve database schemas using intelligent, code-first or data-first guidance",
    );
    public static helpCapabilityContextualSuggestions = l10n.t(
        "Apply contextual suggestions for SQL syntax, relationships, and constraints",
    );
    public static helpCapabilityWriteOptimize = l10n.t(
        "Write, optimize, and troubleshoot SQL queries with AI-recommended improvements",
    );
    public static helpCapabilityGenerateMockData = l10n.t(
        "Generate mock data and seed scripts to support testing and development environments",
    );
    public static helpCapabilityAccelerateSchema = l10n.t(
        "Accelerate schema evolution by autogenerating ORM migrations or T-SQL change scripts",
    );
    public static helpCapabilityUnderstandDocument = l10n.t(
        "Understand and document business logic embedded in stored procedures, views, and functions",
    );
    public static helpCapabilitySecurityRecommendations = l10n.t(
        "Get security-related recommendations, such as avoiding SQL injection or excessive permissions",
    );
    public static helpCapabilityNaturalLanguage = l10n.t(
        "Receive natural language explanations to help developers unfamiliar with T-SQL understand code",
    );
    public static helpCapabilityReverseEngineer = l10n.t(
        "Reverse-engineer existing databases by explaining SQL schemas and relationships",
    );
    public static helpCapabilityScaffoldComponents = l10n.t(
        "Scaffold backend components (e.g., data-access layers) based on your current database context",
    );
}

export class QueryEditor {
    public static codeLensConnect = l10n.t("$(plug)  Connect to MSSQL");
    public static queryCancelFailed(errorMessage: string) {
        return l10n.t({
            message: "Cancel failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    public static queryDisposeFailed(errorMessage: string) {
        return l10n.t({
            message: "Failed disposing query: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
}

export class ConnectionSharing {
    public static connectionSharingRequestNotification(extensionName: string) {
        return l10n.t({
            message:
                "The extension '{0}' is requesting access to your SQL Server connections. This will allow it to execute queries and access your database.",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    }
    public static Approve = l10n.t("Approve");
    public static Deny = l10n.t("Deny");
    public static GrantAccess = l10n.t("✅ Grant Access");
    public static GrantAccessCurrent = l10n.t("✅ Grant Access (Current)");
    public static DenyAccess = l10n.t("❌ Deny Access");
    public static DenyAccessCurrent = l10n.t("❌ Deny Access (Current)");
    public static AllowThisExtensionToAccessYourConnections = l10n.t(
        "Allow this extension to access your connections",
    );
    public static BlockThisExtensionFromAccessingYourConnections = l10n.t(
        "Block this extension from accessing your connections",
    );
    public static SelectAnExtensionToManage = l10n.t(
        "Select an extension to manage connection sharing permissions",
    );
    public static SelectNewPermission = (extensionName: string) => {
        return l10n.t({
            message: "Select new permission for extension: '{0}'",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    };
    public static ClearAllPermissions = l10n.t(
        "Clear permissions for all extensions to access your connections",
    );
    public static Clear = l10n.t("Clear");
    public static Cancel = l10n.t("Cancel");
    public static AllPermissionsCleared = l10n.t(
        "All permissions for extensions to access your connections have been cleared.",
    );
    public static noActiveEditorError = l10n.t(
        "No active text editor found. Please open a file with an active database connection.",
    );
    public static connectionNotFoundError(connectionId: string) {
        return l10n.t({
            message: `Connection with ID "{0}" not found. Please verify the connection ID exists.`,
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    }
    public static failedToEstablishConnectionError(connectionId: string) {
        return l10n.t({
            message: `Failed to establish connection with ID "{0}". Please check connection details and network connectivity.`,
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    }
    public static invalidConnectionUri = l10n.t("Invalid connection URI provided.");
    public static connectionNotActive = l10n.t(
        "Connection is not active. Please establish a connection before performing this action.",
    );
    public static permissionDenied(extensionId: string) {
        return l10n.t({
            message: `Connection sharing permission denied for extension: '{0}'. Use the permission management commands to change this.`,
            args: [extensionId],
            comment: ["{0} is the extension ID"],
        });
    }
    public static permissionRequired(extensionId: string) {
        return l10n.t({
            message: `Connection sharing permission is required for extension: '{0}'`,
            args: [extensionId],
            comment: ["{0} is the extension ID"],
        });
    }
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

export class DacpacDialog {
    public static Title = l10n.t("Data-tier Application (Preview)");
    public static FilePathRequired = l10n.t("File path is required");
    public static FileNotFound = l10n.t("File not found");
    public static InvalidFileExtension = l10n.t(
        "Invalid file extension. Expected .dacpac or .bacpac",
    );
    public static DirectoryNotFound = l10n.t("Directory not found");
    public static FileAlreadyExists = l10n.t(
        "File already exists. It will be overwritten if you continue",
    );
    public static DatabaseNameRequired = l10n.t("Database name is required");
    public static InvalidDatabaseName = l10n.t(
        'Database name contains invalid characters. Avoid using: < > * ? " / \\ |',
    );
    public static DatabaseNameTooLong = l10n.t(
        "Database name is too long. Maximum length is 128 characters",
    );
    public static DatabaseAlreadyExists = l10n.t(
        "A database with this name already exists on the server",
    );
    public static DatabaseNotFound = l10n.t("Database not found on the server");
    public static ValidationFailed = l10n.t("Validation failed. Please check your inputs");
    public static DeployToExistingWarning = l10n.t("Deploy to Existing Database");
    public static DeployToExistingMessage = l10n.t(
        "You are about to deploy to an existing database. This operation will make permanent changes to the database schema and may result in data loss. Do you want to continue?",
    );
    public static DeployToExistingConfirm = l10n.t("Deploy");
    public static Cancel = l10n.t("Cancel");
    public static Select = l10n.t("Select");
    public static Save = l10n.t("Save");
    public static Files = l10n.t("Files");
    public static InvalidApplicationVersion = l10n.t(
        "Application version must be in format n.n.n.n where n is a number (e.g., 1.0.0.0)",
    );
    public static RevealInExplorer = l10n.t("Reveal in Explorer");
    public static RevealInFinder = l10n.t("Reveal in Finder");
    public static OpenContainingFolder = l10n.t("Open Containing Folder");
    public static DeploySuccessWithDatabase(databaseName: string): string {
        return l10n.t({
            message: "DACPAC deployed successfully to database '{0}'",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    public static ExtractSuccessWithFile(filePath: string): string {
        return l10n.t({
            message: "DACPAC extracted successfully to '{0}'",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    }
    public static ImportSuccessWithDatabase(databaseName: string): string {
        return l10n.t({
            message: "BACPAC imported successfully to database '{0}'",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    public static ExportSuccessWithFile(filePath: string): string {
        return l10n.t({
            message: "BACPAC exported successfully to '{0}'",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    }
}

export class GlobalSearch {
    public static title = (serverName: string) =>
        l10n.t({
            message: "Global Search - {0} (Preview)",
            args: [serverName],
            comment: ["{0} is the server name"],
        });

    public static failedToEstablishConnection = l10n.t(
        "Failed to establish connection for scripting",
    );

    public static noNodeSelected = l10n.t(
        "Unable to open Global Search: No Object Explorer node provided. Please select a server or database node in Object Explorer.",
    );

    public static typeTable = l10n.t("Table");
    public static typeView = l10n.t("View");
    public static typeStoredProcedure = l10n.t("Stored Procedure");
    public static typeFunction = l10n.t("Function");
    public static typeUnknown = l10n.t("Unknown");

    public static copiedToClipboard = (objectName: string) =>
        l10n.t({
            message: 'Copied "{0}" to clipboard',
            args: [objectName],
            comment: ["{0} is the object name"],
        });

    public static failedToScriptObject = (errorMessage: string) =>
        l10n.t({
            message: "Failed to script object: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToOpenEditData = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open Edit Data: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToOpenModifyTable = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open Modify Table: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
}

export class TableExplorer {
    public static unableToOpenTableExplorer = l10n.t(
        "Unable to open Table Explorer: No target node provided.",
    );
    public static changesSavedSuccessfully = l10n.t("Changes saved successfully.");
    public static rowCreatedSuccessfully = l10n.t("Row created.");
    public static rowMarkedForRemoval = l10n.t("Row marked for removal.");
    public static rowDeletedSuccessfully = l10n.t("Row deleted.");

    public static title = (tableName: string) =>
        l10n.t({
            message: "{0} (Preview)",
            args: [tableName],
            comment: ["{0} is the table name"],
        });

    public static failedToSaveChanges = (errorMessage: string) =>
        l10n.t({
            message: "Failed to save changes: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToLoadData = (errorMessage: string) =>
        l10n.t({
            message: "Failed to load data: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToCreateNewRow = (errorMessage: string) =>
        l10n.t({
            message: "Failed to create a new row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRemoveRow = (errorMessage: string) =>
        l10n.t({
            message: "Failed to remove row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToUpdateCell = (errorMessage: string) =>
        l10n.t({
            message: "Failed to update cell: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRevertCell = (errorMessage: string) =>
        l10n.t({
            message: "Failed to revert cell: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToRevertRow = (errorMessage: string) =>
        l10n.t({
            message: "Failed to revert row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static failedToGenerateScript = (errorMessage: string) =>
        l10n.t({
            message: "Failed to generate script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static noScriptToOpen = l10n.t(
        "No script available. Make changes to the table data and generate a script first.",
    );

    public static failedToOpenScript = (errorMessage: string) =>
        l10n.t({
            message: "Failed to open script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static scriptCopiedToClipboard = l10n.t("Script copied to clipboard.");

    public static noScriptToCopy = l10n.t(
        "No script available. Make changes to the table data and generate a script first.",
    );

    public static failedToCopyScript = (errorMessage: string) =>
        l10n.t({
            message: "Failed to copy script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });

    public static unsavedChangesPrompt = (tableName: string) =>
        l10n.t({
            message:
                "Table Explorer for '{0}' has unsaved changes. Do you want to save or discard them?",
            args: [tableName],
            comment: ["{0} is the table name"],
        });

    public static Save = l10n.t("Save");
    public static Discard = l10n.t("Discard");
    public static Cancel = l10n.t("Cancel");

    public static exportSuccessful = (filePath: string) =>
        l10n.t({
            message: "Results exported successfully to {0}",
            args: [filePath],
            comment: ["{0} is the file path"],
        });

    public static exportFailed = (errorMessage: string) =>
        l10n.t({
            message: "Failed to export results: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
}

export class AzureDataStudioMigration {
    public static PageTitle = l10n.t("Azure Data Studio Migration");
    public static SelectConfigFileDialogTitle = l10n.t(
        "Locate an Azure Data Studio settings.json file to import",
    );
    public static ImportStatusReady = l10n.t("Ready for import");
    public static ConnectionStatusNeedsAttention = l10n.t("Needs attention");
    public static ConnectionStatusAlreadyImported = (
        connectionDisplayName: string,
        connectionId: string,
    ) =>
        l10n.t({
            message: "Connection with the same ID is already imported: {0} (ID: {1})",
            args: [connectionDisplayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });

    public static ConnectionGroupStatusAlreadyImported = (groupName: string, groupId: string) =>
        l10n.t({
            message: "Connection group with the same ID is already imported: {0} (ID: {1})",
            args: [groupName, groupId],
            comment: ["{0} is the group name", "{1} is the group ID"],
        });
    public static connectionIssueMissingSqlPassword = (username: string) =>
        l10n.t({
            message: "Enter the SQL Login password for user '{0}'.",
            args: [username],
            comment: ["{0} is the SQL Login username"],
        });
    public static connectionIssueMissingAzureAccount = (username: string) =>
        l10n.t({
            message: "Sign in with Entra ID '{0}'.",
            args: [username],
            comment: ["{0} is the Entra ID username"],
        });

    public static EntraSignInDialogUnknownAccount = l10n.t("Unknown account");
    public static EntraSignInDialogUnknownTenant = l10n.t("Unknown tenant ID");

    public static importProgressSuccessMessage = l10n.t(
        "Import complete. You can close this dialog.",
    );
    public static importProgressErrorMessage = (error: string) =>
        l10n.t({
            message: "Import failed: {0}",
            args: [error],
            comment: ["{0} is the error message returned from the import helper."],
        });

    public static groupNotSelectedWillBeMovedToRootWarning = l10n.t(
        "This connection's group has not been selected, so this connection will be imported to the root.",
    );
}

export class Changelog {
    public static ChangelogDocumentTitle = l10n.t("MSSQL: Welcome & What's New");
    public static tryIt = l10n.t("Try it");
    public static watchDemo = l10n.t("Watch demo");
    public static learnMore = l10n.t("Learn more");
    public static readDocs = l10n.t("Read docs");
    public static watchDemosOnYoutube = l10n.t("Watch demos on YouTube");
    public static viewRoadmap = l10n.t("View roadmap");
    public static readTheDocumentation = l10n.t("Read docs on Microsoft Learn");
    public static joinTheDiscussions = l10n.t("Join the discussions");
    public static customizeKeyboardShortcuts = l10n.t("Customize keyboard shortcuts");

    // Main content
    public static mainContentTitle = l10n.t("Highlights");
    public static adsMigrationTitle = l10n.t("Azure Data Studio Connection Migration Toolkit");
    public static adsMigrationDescription = l10n.t(
        "Migrate saved connections and connection groups from Azure Data Studio into the MSSQL extension. This guided experience helps you continue working with familiar environments with minimal setup.",
    );
    public static editDataTitle = l10n.t("Edit Data (Preview)");
    public static editDataDescription = l10n.t(
        "View, edit, add, and delete table rows in an interactive grid with real-time validation and live DML script previews.",
    );
    public static dacpacTitle = l10n.t(
        "Data-Tier Application (DACPAC / BACPAC) Import & Export (Preview)",
    );
    public static dacpacDescription = l10n.t(
        "Deploy and extract .dacpac files or import/export .bacpac packages using an integrated, streamlined workflow in the MSSQL extension.",
    );
    public static sqlProjPublishTitle = l10n.t("SQL Database Projects – Publish Dialog (Preview)");
    public static sqlProjPublishDescription = l10n.t(
        "Deploy database changes using a guided Publish Dialog in SQL Database Projects, with script preview for SQL Server and Azure SQL databases.",
    );

    // Secondary content
    public static secondaryContentTitle = l10n.t("In case you missed it");
    public static secondaryContentDescription = l10n.t(
        "Previously released features you may not have explored yet.",
    );
    public static schemaDesignerTitle = l10n.t("Schema Designer");
    public static schemaDesignerDescription = l10n.t(
        "Design, visualize, and evolve database schemas using an interactive diagram with synchronized SQL generation.",
    );
    public static schemaCompareTitle = l10n.t("Schema Compare");
    public static schemaCompareDescription = l10n.t(
        "Compare database schemas across databases, DACPAC files, or SQL projects. Review differences and apply changes or generate deployment scripts to keep schemas in sync.",
    );
    public static localContainerTitle = l10n.t("Local SQL Server Container");
    public static localContainerDescription = l10n.t(
        "Create and manage local SQL Server containers directly from VS Code for fast, consistent local development.",
    );
    public static copilotIntegrationTitle = l10n.t("GitHub Copilot integration");
    public static copilotIntegrationDescription = l10n.t(
        "Al-assisted SQL development with schema-aware query generation, ORM support, and natural language chat with @mssql in Ask or Agent Mode.",
    );

    // Sidebar content
    public static resourcesTitle = l10n.t("Resources");
    public static resourcesDescription = l10n.t("Explore tutorials, docs, and what's coming next.");
    public static feedbackTitle = l10n.t("Feedback");
    public static feedbackDescription = l10n.t("Help us improve by sharing your thoughts.");
    public static openNewBug = l10n.t("Open a new bug");
    public static requestNewFeature = l10n.t("Request a new feature");
    public static copilotSurvey = l10n.t("GitHub Copilot survey");
    public static gettingStartedTitle = l10n.t("Getting Started");
    public static gettingStartedDescription = l10n.t(
        "New to the MSSQL extension? Check out our quick-start guide.",
    );
    public static mssqlWalkthrough = l10n.t("MSSQL - VS Code walkthrough");
    public static copilotWalkthrough = l10n.t("GitHub Copilot - VS Code walkthrough");
}

export class Proxy {
    public static missingProtocolWarning = (proxy: string) =>
        l10n.t({
            message:
                "Proxy settings found, but without a protocol (e.g. http://): '{0}'.  You may encounter connection issues while using the MSSQL extension.",
            args: [proxy],
            comment: ["{0} is the proxy URL"],
        });

    public static unparseableWarning = (proxy: string, errorMessage: string) =>
        l10n.t({
            message:
                "Proxy settings found, but encountered an error while parsing the URL: '{0}'.  You may encounter connection issues while using the MSSQL extension.  Error: {1}",
            args: [proxy, errorMessage],
            comment: ["{0} is the proxy URL", "{1} is the error message"],
        });
}

export class BackupDatabase {
    public static backupDatabaseTitle = (databaseName: string) =>
        l10n.t({
            message: "Backup Database - {0}",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    public static backupName = l10n.t("Backup Name");
    public static recoveryModel = l10n.t("Recovery Model");
    public static full = l10n.t("Full");
    public static bulkLogged = l10n.t("Bulk-logged");
    public static simple = l10n.t("Simple");
    public static backupType = l10n.t("Backup Type");
    public static differential = l10n.t("Differential");
    public static transactionLog = l10n.t("Transaction Log");
    public static copyOnly = l10n.t("Copy-only Backup");
    public static saveToUrl = l10n.t("Save backup to URL");
    public static azureAccount = l10n.t("Azure Account");
    public static azureAccountIsRequired = l10n.t("Azure Account is required");
    public static tenant = l10n.t("Tenant");
    public static tenantIsRequired = l10n.t("Tenant is required");
    public static storageAccount = l10n.t("Storage Account");
    public static storageAccountIsRequired = l10n.t("Storage Account is required");
    public static selectAStorageAccount = l10n.t("Select a storage account");
    public static blobContainer = l10n.t("Blob Container");
    public static selectABlobContainer = l10n.t("Select a blob container");
    public static blobContainerIsRequired = l10n.t("Blob Container is required");
    public static subscription = l10n.t("Subscription");
    public static selectASubscription = l10n.t("Select a subscription");
    public static subscriptionIsRequired = l10n.t("Subscription is required");
    public static backupFiles = l10n.t("Backup Files");
    public static compression = l10n.t("Compression");
    public static backupCompression = l10n.t("Set backup Compression");
    public static useDefault = l10n.t("Use the default server setting");
    public static compressBackup = l10n.t("Compress backup");
    public static doNotCompressBackup = l10n.t("Do not compress backup");
    public static media = l10n.t("Media");
    public static append = l10n.t("Append to the existing backup set");
    public static overwrite = l10n.t("Overwrite all existing backup sets");
    public static create = l10n.t("Backup to a new media set");
    public static unavailableForBackupsToExistingFiles = l10n.t(
        "Unavailable for backups to existing files",
    );
    public static pleaseChooseValidMediaOption = l10n.t("Please choose a valid media option");
    public static backupMediaSet = l10n.t("Set backup Media Set");
    public static newMediaSetName = l10n.t("New media set name");
    public static mediaSetNameIsRequired = l10n.t("Media set name is required");
    public static newMediaSetDescription = l10n.t("New media set description");
    public static mediaSetDescriptionIsRequired = l10n.t("Media set description is required");
    public static reliability = l10n.t("Reliability");
    public static performChecksum = l10n.t("Perform checksum before writing to media");
    public static verifyBackup = l10n.t("Verify backup when finished");
    public static continueOnError = l10n.t("Continue on error");
    public static truncateLog = l10n.t("Truncate the transaction log");
    public static backupTail = l10n.t("Backup the tail of the log");
    public static expiration = l10n.t("Expiration");
    public static retainDays = l10n.t("Set backup retain days");
    public static encryption = l10n.t("Encryption");
    public static enableEncryption = l10n.t("Use encryption for this backup");
    public static encryptionAlgorithm = l10n.t("Encryption Algorithm");
    public static encryptionType = l10n.t("Encryption Type");
    public static backupFileTypes = l10n.t("Backup Files (*.bak, *.log, *.trn)");
    public static allFiles = l10n.t("All Files (*.*)");
    public static noTenantsFound = l10n.t("No tenants found");
    public static noSubscriptionsFound = l10n.t("No subscriptions found");
    public static noStorageAccountsFound = l10n.t("No storage accounts found");
    public static noBlobContainersFound = l10n.t("No blob containers found");
    public static generatingSASKeyFailedWithError = (errorMessage: string) => {
        return l10n.t({
            message: "Generating SAS key failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
}
