"use strict";
/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
Object.defineProperty(exports, "__esModule", { value: true });
exports.azureAuthTypeCodeGrant =
    exports.authTypeAzureServicePrincipal =
    exports.authTypeAzureActiveDirectoryDefault =
    exports.authTypeAzureActiveDirectory =
    exports.authTypeSql =
    exports.authTypeIntegrated =
    exports.authTypeName =
    exports.authTypePrompt =
    exports.databasePlaceholder =
    exports.firewallRuleNamePrompt =
    exports.endIpAddressPrompt =
    exports.startIpAddressPrompt =
    exports.databasePrompt =
    exports.serverPlaceholder =
    exports.serverPrompt =
    exports.SampleServerName =
    exports.ManageProfilesPrompt =
    exports.RemoveProfileLabel =
    exports.EditProfilesLabel =
    exports.ClearRecentlyUsedLabel =
    exports.CreateProfileLabel =
    exports.CreateProfileFromConnectionsListLabel =
    exports.recentConnectionsPlaceholder =
    exports.msgOpenSqlFile =
    exports.msgPromptClearRecentConnections =
    exports.msgConnectionInProgress =
    exports.msgPromptCancelConnect =
    exports.serverNameMissing =
    exports.msgChooseDatabasePlaceholder =
    exports.msgChooseDatabaseNotConnected =
    exports.msgCancelQueryNotRunning =
    exports.runQueryBatchStartMessage =
    exports.msgRunQueryInProgress =
    exports.releaseNotesPromptDescription =
    exports.viewMore =
    exports.msgSelectDatabaseNodeToRename =
    exports.msgSelectDatabaseNodeToDrop =
    exports.msgSelectServerNodeToCreateDatabase =
    exports.quickQuerySelectedTextRequired =
    exports.quickQuerySlotOutOfRange =
    exports.shortcutsConfigurationSaved =
    exports.shortcutsConfigurationTitle =
    exports.renameDatabaseWebviewTitle =
    exports.dropDatabaseWebviewTitle =
    exports.createDatabaseWebviewTitle =
    exports.renameDatabaseDialogTitle =
    exports.dropDatabaseDialogTitle =
    exports.createDatabaseDialogTitle =
    exports.SqlToolsMcp =
    exports.Common =
        void 0;
exports.connectErrorCode =
    exports.connectErrorTooltip =
    exports.connectingTooltip =
    exports.defaultDatabaseLabel =
    exports.msgNo =
    exports.msgYes =
    exports.msgError =
    exports.msgIsRequired =
    exports.msgClearedRecentConnections =
    exports.msgProfileCreatedAndConnected =
    exports.msgProfileCreated =
    exports.msgProfileRemoved =
    exports.msgNoProfilesToEdit =
    exports.msgNoProfilesToRemove =
    exports.confirmRemoveProfilePrompt =
    exports.msgSelectProfileToEdit =
    exports.msgSelectProfileToRemove =
    exports.msgCannotOpenContent =
    exports.profileNamePrompt =
    exports.msgSavePassword =
    exports.passwordPlaceholder =
    exports.passwordPrompt =
    exports.usernamePlaceholder =
    exports.usernamePrompt =
    exports.tenant =
    exports.azureChooseTenant =
    exports.aad =
    exports.cannotConnect =
    exports.noAzureAccountForRemoval =
    exports.accountRemovedSuccessfully =
    exports.accountCouldNotBeAdded =
    exports.azureAddAccount =
    exports.azureChooseAccount =
    exports.msgCopyAndOpenWebpage =
    exports.readMore =
    exports.enableTrustServerCertificate =
    exports.encryptMandatoryRecommended =
    exports.encryptMandatory =
    exports.encryptOptional =
    exports.encryptName =
    exports.encryptPrompt =
    exports.azureAuthStateError =
    exports.azureAuthNonceError =
    exports.azureServerCouldNotStart =
    exports.azureMicrosoftAccount =
    exports.azureMicrosoftCorpAccount =
    exports.azureConsentDialogIgnore =
    exports.azureConsentDialogOpen =
    exports.azureLogChannelName =
    exports.azureAuthTypeDeviceCode =
        void 0;
exports.resultPaneLabel =
    exports.fileTypeAllFilesLabel =
    exports.fileTypeExcelLabel =
    exports.fileTypeJSONLabel =
    exports.fileTypeCSVLabel =
    exports.saveExcelLabel =
    exports.saveJSONLabel =
    exports.saveCSVLabel =
    exports.restoreLabel =
    exports.maximizeLabel =
    exports.noActiveEditorMsg =
    exports.disconnectConfirmationMsg =
    exports.disconnectOptionDescription =
    exports.disconnectOptionLabel =
    exports.testLocalizationConstant =
    exports.intelliSenseUpdatedStatus =
    exports.updatingIntelliSenseStatus =
    exports.definitionRequestCompletedStatus =
    exports.definitionRequestedStatus =
    exports.gettingDefinitionMessage =
    exports.macSierraRequiredErrorMessage =
    exports.help =
    exports.msgAzureCredStoreSaveFailedError =
    exports.msgRefreshTokenError =
    exports.createFirewallRuleLabel =
    exports.retryLabel =
    exports.msgNoQueriesAvailable =
    exports.msgInvalidRuleName =
    exports.msgInvalidIpAddress =
    exports.msgRunQueryHistory =
    exports.msgOpenQueryHistory =
    exports.msgChooseQueryHistoryAction =
    exports.msgChooseQueryHistory =
    exports.msgAccountNotFound =
    exports.msgAuthTypeNotFound =
    exports.msgPromptFirewallRuleCreated =
    exports.msgUnableToExpand =
    exports.msgPromptProfileUpdateFailed =
    exports.msgPromptRetryFirewallRuleAdded =
    exports.msgPromptRetryFirewallRuleNotSignedIn =
    exports.msgPromptRetryConnectionDifferentCredentials =
    exports.msgGetTokenFail =
    exports.refreshTokenLabel =
    exports.msgPromptRetryCreateProfile =
    exports.msgChangeLanguageMode =
    exports.untitledScheme =
    exports.extensionNotInitializedError =
    exports.updatingIntelliSenseLabel =
    exports.cancelingQueryLabel =
    exports.connectErrorMessage =
        void 0;
exports.columnWidthMustBePositiveError =
    exports.columnWidthInvalidNumberError =
    exports.newColumnWidthPrompt =
    exports.msgObjectManagementUnknownDialog =
    exports.msgNoScriptGenerated =
    exports.msgScriptingEditorFailed =
    exports.msgScriptingFailed =
    exports.msgSelectSingleNodeToScript =
    exports.msgSelectNodeToScript =
    exports.msgNoQueryTextToExecute =
    exports.msgMultipleSelectionModeNotSupported =
    exports.connectProgressNoticationTitle =
    exports.msgClearedRecentConnectionsWithErrors =
    exports.nodeErrorMessage =
    exports.notStarted =
    exports.canceling =
    exports.inProgress =
    exports.canceled =
    exports.succeededWithWarning =
    exports.succeeded =
    exports.failed =
    exports.backgroundTaskCancelConfirm =
    exports.backgroundTaskCancelConfirmation =
    exports.backgroundTaskLogUnavailable =
    exports.backgroundTaskNoLogEntries =
    exports.backgroundTaskLogsHeader =
    exports.noBackgroundTasks =
    exports.azureSignInToAzureCloudDescription =
    exports.azureSignInToAzureCloud =
    exports.azureSignInWithDeviceCodeDescription =
    exports.azureSignInWithDeviceCode =
    exports.azureSignInDescription =
    exports.azureSignIn =
    exports.msgConnect =
    exports.msgAddConnection =
    exports.autoDisableNonTSqlLanguageServicePrompt =
    exports.flavorDescriptionNone =
    exports.flavorDescriptionMssql =
    exports.flavorChooseLanguage =
    exports.noneProviderName =
    exports.mssqlProviderName =
    exports.msgCannotSaveMultipleSelections =
    exports.messagesTableMessageColumn =
    exports.messagesTableTimeStampColumn =
    exports.messagePaneLabel =
    exports.QueryExecutedLabel =
    exports.executeQueryLabel =
    exports.copyWithHeadersLabel =
    exports.copyLabel =
    exports.selectAll =
        void 0;
exports.QueryEditor =
    exports.MssqlChatAgent =
    exports.Connection =
    exports.StatusBar =
    exports.SchemaDesigner =
    exports.SchemaCompare =
    exports.CodeAnalysis =
    exports.PublishProject =
    exports.TableDesigner =
    exports.Webview =
    exports.UserSurvey =
    exports.LocalContainers =
    exports.QueryResult =
    exports.FabricProvisioning =
    exports.AzureSqlDatabase =
    exports.Accounts =
    exports.Fabric =
    exports.Azure =
    exports.FirewallRule =
    exports.ConnectionDialog =
    exports.ObjectExplorer =
    exports.Notebooks =
    exports.overwriteDeploymentScript =
    exports.deploymentScriptAlreadyExists =
    exports.noWorkspaceOpenForDeploymentScript =
    exports.newDeployment =
    exports.inMemoryDataProcessingThresholdExceeded =
    exports.keepInQueryPane =
    exports.alwaysShowInNewTab =
    exports.openQueryResultsInTabByDefaultPrompt =
    exports.copyingResults =
    exports.schemaDesignerDetailsUnavailable =
    exports.failedToAddTextToWorkspace =
    exports.failedToCopyTextToClipboard =
    exports.failedToOpenTextInEditor =
    exports.copied =
    exports.scriptCopiedToClipboard =
    exports.executionPlanFileFilter =
    exports.executionPlan =
    exports.loading =
    exports.parameters =
    exports.queryFailed =
    exports.querySuccess =
    exports.dismiss =
    exports.switchToMsal =
    exports.reloadChoice =
    exports.reloadPromptGeneric =
    exports.reloadPrompt =
    exports.showOutputChannelActionButtonText =
    exports.objectExplorerNodeRefreshError =
        void 0;
exports.specifiesWhetherTheColumnMayHaveA =
    exports.defaultValue =
    exports.aPredefinedGlobalDefaultValueForThe =
    exports.length =
    exports.theMaximumLengthInCharactersThatCan =
    exports.typeLabel =
    exports.displaysTheDataTypeNameForThe =
    exports.dataType =
    exports.displaysTheUnifiedDataTypeIncludingLength =
    exports.description2 =
    exports.displaysTheDescriptionOfTheColumn =
    exports.name =
    exports.theNameOfTheColumnObject =
    exports.description =
    exports.descriptionForTheTable =
    exports.objectExplorerFilter =
    exports.replication =
    exports.alwaysEncrypted =
    exports.commandTimeout =
    exports.connectionTimeout =
    exports.applicationIntent =
    exports.sqlContainerVersion =
    exports.sqlContainerName =
    exports.port =
    exports.user =
    exports.authenticationType =
    exports.database =
    exports.server =
    exports.disabled =
    exports.enabled =
    exports.windowsAuthentication =
    exports.azureMFA =
    exports.serializationFailed =
    exports.azureSubscriptionNotFoundInCache =
    exports.errorLoadingAzureSubscriptions =
    exports.selectSubscriptions =
    exports.azureSignInFailed =
    exports.Formatter =
    exports.ServiceClient =
    exports.RestoreDatabase =
    exports.FlatFileImport =
    exports.BackupDatabase =
    exports.Profiler =
    exports.Changelog =
    exports.AzureDataStudioMigration =
    exports.TableExplorer =
    exports.SearchDatabase =
    exports.DacpacDialog =
    exports.ConnectionGroup =
    exports.ConnectionSharing =
        void 0;
exports.foreignKey =
    exports.foreignKeys =
    exports.newColumnMapping =
    exports.columns4 =
    exports.columns3 =
    exports.theMappingBetweenForeignKeyColumnsAnd =
    exports.onDeleteAction =
    exports.theBehaviorWhenAUserTriesTo2 =
    exports.onUpdateAction =
    exports.theBehaviorWhenAUserTriesTo =
    exports.foreignTable =
    exports.theTableWhichContainsThePrimaryOr =
    exports.description5 =
    exports.theDescriptionOfTheForeignKey =
    exports.name4 =
    exports.theNameOfTheForeignKey =
    exports.column4 =
    exports.foreignColumn =
    exports.newIndex =
    exports.index =
    exports.indexes =
    exports.addColumn2 =
    exports.columns2 =
    exports.theColumnsOfTheIndex =
    exports.description4 =
    exports.theDescriptionOfTheIndex =
    exports.name3 =
    exports.theNameOfTheIndex =
    exports.column3 =
    exports.theNameOfTheColumn2 =
    exports.addColumn =
    exports.primaryKeyColumns2 =
    exports.primaryKeyColumns =
    exports.columnsInThePrimaryKey =
    exports.description3 =
    exports.theDescriptionOfThePrimaryKey =
    exports.name2 =
    exports.nameOfThePrimaryKey =
    exports.column2 =
    exports.theNameOfTheColumn =
    exports.newColumn =
    exports.column =
    exports.columns =
    exports.scale =
    exports.forNumericDataTheMaximumNumberOf2 =
    exports.precision =
    exports.forNumericDataTheMaximumNumberOf =
    exports.primaryKey =
    exports.specifiesWhetherTheColumnIsIncludedIn =
    exports.allowNulls =
        void 0;
exports.DataWorkspace =
    exports.SqlMoveToSchema =
    exports.SqlSymbolRename =
    exports.advancedOptions =
    exports.checkConstraints2 =
    exports.foreignKeys2 =
    exports.indexes2 =
    exports.primaryKey2 =
    exports.columns5 =
    exports.newCheckConstraint =
    exports.checkConstraint =
    exports.checkConstraints =
    exports.expression =
    exports.theExpressionDefiningTheCheckConstraint =
    exports.description6 =
    exports.theDescriptionOfTheCheckConstraint =
    exports.name5 =
    exports.theNameOfTheCheckConstraint =
    exports.newForeignKey =
        void 0;
exports.createDatabaseError = createDatabaseError;
exports.dropDatabaseError = dropDatabaseError;
exports.renameDatabaseError = renameDatabaseError;
exports.renamingDatabase = renamingDatabase;
exports.msgStartedExecute = msgStartedExecute;
exports.msgFinishedExecute = msgFinishedExecute;
exports.runQueryBatchStartLine = runQueryBatchStartLine;
exports.msgCancelQueryFailed = msgCancelQueryFailed;
exports.msgConnectionError = msgConnectionError;
exports.msgConnectionError2 = msgConnectionError2;
exports.msgConnectionErrorPasswordExpired = msgConnectionErrorPasswordExpired;
exports.azureConsentDialogBody = azureConsentDialogBody;
exports.azureConsentDialogBodyAccount = azureConsentDialogBodyAccount;
exports.azureNoMicrosoftResource = azureNoMicrosoftResource;
exports.accountAddedSuccessfully = accountAddedSuccessfully;
exports.accountRemovalFailed = accountRemovalFailed;
exports.msgSaveStarted = msgSaveStarted;
exports.msgSaveFailed = msgSaveFailed;
exports.msgSaveSucceeded = msgSaveSucceeded;
exports.msgChangedDatabaseContext = msgChangedDatabaseContext;
exports.msgPromptRetryFirewallRuleSignedIn = msgPromptRetryFirewallRuleSignedIn;
exports.msgAccountRefreshFailed = msgAccountRefreshFailed;
exports.msgConnecting = msgConnecting;
exports.msgConnectionNotFound = msgConnectionNotFound;
exports.msgFoundPendingReconnect = msgFoundPendingReconnect;
exports.msgPendingReconnectSuccess = msgPendingReconnectSuccess;
exports.msgFoundPendingReconnectFailed = msgFoundPendingReconnectFailed;
exports.msgFoundPendingReconnectError = msgFoundPendingReconnectError;
exports.msgAcessTokenExpired = msgAcessTokenExpired;
exports.msgRefreshConnection = msgRefreshConnection;
exports.msgRefreshTokenSuccess = msgRefreshTokenSuccess;
exports.msgRefreshTokenNotNeeded = msgRefreshTokenNotNeeded;
exports.msgConnectedServerInfo = msgConnectedServerInfo;
exports.msgConnectionFailed = msgConnectionFailed;
exports.msgChangingDatabase = msgChangingDatabase;
exports.msgChangedDatabase = msgChangedDatabase;
exports.msgDisconnected = msgDisconnected;
exports.elapsedBatchTime = elapsedBatchTime;
exports.lineSelectorFormatted = lineSelectorFormatted;
exports.elapsedTimeLabel = elapsedTimeLabel;
exports.backgroundTaskName = backgroundTaskName;
exports.backgroundTaskDescription = backgroundTaskDescription;
exports.backgroundTaskStatus = backgroundTaskStatus;
exports.backgroundTaskSource = backgroundTaskSource;
exports.backgroundTaskConnection = backgroundTaskConnection;
exports.backgroundTaskTarget = backgroundTaskTarget;
exports.backgroundTaskElapsedTime = backgroundTaskElapsedTime;
exports.backgroundTaskLogLine = backgroundTaskLogLine;
exports.backgroundTaskLogStateWithMessage = backgroundTaskLogStateWithMessage;
exports.backgroundTaskLogStateWithProgress = backgroundTaskLogStateWithProgress;
exports.backgroundTaskLogStateWithProgressAndMessage = backgroundTaskLogStateWithProgressAndMessage;
exports.backgroundTaskElapsedMilliseconds = backgroundTaskElapsedMilliseconds;
exports.backgroundTaskElapsedSeconds = backgroundTaskElapsedSeconds;
exports.backgroundTaskElapsedMinutesAndSeconds = backgroundTaskElapsedMinutesAndSeconds;
exports.backgroundTaskElapsedHoursAndMinutes = backgroundTaskElapsedHoursAndMinutes;
exports.backgroundTaskElapsedDaysAndHours = backgroundTaskElapsedDaysAndHours;
exports.taskStatusWithName = taskStatusWithName;
exports.taskStatusWithMessage = taskStatusWithMessage;
exports.taskStatusWithNameAndMessage = taskStatusWithNameAndMessage;
exports.deleteCredentialError = deleteCredentialError;
exports.msgScriptingObjectNotFound = msgScriptingObjectNotFound;
exports.msgScriptingOperationFailed = msgScriptingOperationFailed;
exports.invalidConnectionString0 = invalidConnectionString0;
exports.loc0Filtered = loc0Filtered;
const vscode_1 = require("vscode");
const os = require("os");
// Warning: Only update these strings if you are sure you want to affect _all_ locations they're shared between.
class Common {
    static remindMeLater = vscode_1.l10n.t("Remind Me Later");
    static dontShowAgain = vscode_1.l10n.t("Don't Show Again");
    static learnMore = vscode_1.l10n.t("Learn More");
    static openFile = vscode_1.l10n.t("Open File");
    static revealInExplorer = vscode_1.l10n.t("Reveal in Explorer");
    static revealInFinder = vscode_1.l10n.t("Reveal in Finder");
    static openContainingFolder = vscode_1.l10n.t("Open Containing Folder");
    static delete = vscode_1.l10n.t("Delete");
    static cancel = vscode_1.l10n.t("Cancel");
    static areYouSure = vscode_1.l10n.t("Are you sure?");
    static areYouSureYouWantTo = (action) =>
        vscode_1.l10n.t({
            message: "Are you sure you want to {0}?",
            args: [action],
            comment: ["{0} is the action being confirmed"],
        });
    static accept = vscode_1.l10n.t("Accept");
    static error = vscode_1.l10n.t("Error");
    static publicString = vscode_1.l10n.t("Public");
    static privateString = vscode_1.l10n.t("Private");
    static remove = vscode_1.l10n.t("Remove");
    static invalidPort = vscode_1.l10n.t("Port must be a number between 1 and 65535");
}
exports.Common = Common;
class SqlToolsMcp {
    static serverLabel = vscode_1.l10n.t("SQL Tools (MSSQL)");
}
exports.SqlToolsMcp = SqlToolsMcp;
exports.createDatabaseDialogTitle = vscode_1.l10n.t("Create Database");
exports.dropDatabaseDialogTitle = vscode_1.l10n.t("Drop Database");
exports.renameDatabaseDialogTitle = vscode_1.l10n.t("Rename Database");
exports.createDatabaseWebviewTitle = vscode_1.l10n.t("Create Database");
exports.dropDatabaseWebviewTitle = vscode_1.l10n.t("Drop Database");
exports.renameDatabaseWebviewTitle = vscode_1.l10n.t("Rename Database");
exports.shortcutsConfigurationTitle = vscode_1.l10n.t("Shortcuts Configuration");
exports.shortcutsConfigurationSaved = vscode_1.l10n.t("Configuration saved.");
let quickQuerySlotOutOfRange = (maxSlot) =>
    vscode_1.l10n.t({
        message: "Quick Query slot must be between 1 and {0}.",
        args: [maxSlot],
        comment: ["{0} is the maximum Quick Query slot number"],
    });
exports.quickQuerySlotOutOfRange = quickQuerySlotOutOfRange;
exports.quickQuerySelectedTextRequired = vscode_1.l10n.t(
    "This shortcut requires selected text to be passed as a parameter. Select text in the SQL editor, then run the shortcut again.",
);
exports.msgSelectServerNodeToCreateDatabase = vscode_1.l10n.t(
    "Please select a server node in Object Explorer to create a database.",
);
exports.msgSelectDatabaseNodeToDrop = vscode_1.l10n.t(
    "Please select a database node in Object Explorer to drop.",
);
exports.msgSelectDatabaseNodeToRename = vscode_1.l10n.t(
    "Please select a database node in Object Explorer to rename.",
);
function createDatabaseError(databaseName, errorMessage) {
    return vscode_1.l10n.t({
        message: "Failed to create database '{0}'. {1}",
        args: [databaseName, errorMessage],
        comment: ["{0} is the database name", "{1} is the error message"],
    });
}
function dropDatabaseError(databaseName, errorMessage) {
    return vscode_1.l10n.t({
        message: "Failed to drop database '{0}'. {1}",
        args: [databaseName, errorMessage],
        comment: ["{0} is the database name", "{1} is the error message"],
    });
}
function renameDatabaseError(databaseName, newDatabaseName, errorMessage) {
    return vscode_1.l10n.t({
        message: "Failed to rename database '{0}' to '{1}'. {2}",
        args: [databaseName, newDatabaseName, errorMessage],
        comment: [
            "{0} is the current database name",
            "{1} is the new database name",
            "{2} is the error message",
        ],
    });
}
function renamingDatabase(databaseName, newDatabaseName) {
    return vscode_1.l10n.t({
        message: "Renaming database '{0}' to '{1}'...",
        args: [databaseName, newDatabaseName],
        comment: ["{0} is the current database name", "{1} is the new database name"],
    });
}
exports.viewMore = vscode_1.l10n.t("View More");
exports.releaseNotesPromptDescription = vscode_1.l10n.t(
    "View mssql for Visual Studio Code release notes?",
);
function msgStartedExecute(documentName) {
    return vscode_1.l10n.t({
        message: 'Started query execution for document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
function msgFinishedExecute(documentName) {
    return vscode_1.l10n.t({
        message: 'Finished query execution for document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
exports.msgRunQueryInProgress = vscode_1.l10n.t(
    "A query is already running for this editor session. Please cancel this query or wait for its completion.",
);
exports.runQueryBatchStartMessage = vscode_1.l10n.t("Started executing query at ");
function runQueryBatchStartLine(lineNumber) {
    return vscode_1.l10n.t({
        message: "Line {0}",
        args: [lineNumber],
        comment: ["{0} is the line number"],
    });
}
function msgCancelQueryFailed(error) {
    return vscode_1.l10n.t({
        message: "Canceling the query failed: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
exports.msgCancelQueryNotRunning = vscode_1.l10n.t("Cannot cancel query as no query is running.");
exports.msgChooseDatabaseNotConnected = vscode_1.l10n.t(
    "No connection was found. Please connect to a server first.",
);
exports.msgChooseDatabasePlaceholder = vscode_1.l10n.t("Choose a database from the list below");
function msgConnectionError(errorNumber, errorMessage) {
    return vscode_1.l10n.t({
        message: "Error {0}: {1}",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
function msgConnectionError2(errorMessage) {
    return vscode_1.l10n.t({
        message: "Failed to connect: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
}
exports.serverNameMissing = vscode_1.l10n.t("Server name not set.");
function msgConnectionErrorPasswordExpired(errorNumber, errorMessage) {
    return vscode_1.l10n.t({
        message:
            "Error {0}: {1} Please login as a different user and change the password using ALTER LOGIN.",
        args: [errorNumber, errorMessage],
        comment: ["{0} is the error number", "{1} is the error message"],
    });
}
exports.msgPromptCancelConnect = vscode_1.l10n.t(
    "Server connection in progress. Do you want to cancel?",
);
exports.msgConnectionInProgress = vscode_1.l10n.t(
    "A connection is already being established. Please wait for it to complete before running a query.",
);
exports.msgPromptClearRecentConnections = vscode_1.l10n.t(
    "Confirm to clear recent connections list",
);
exports.msgOpenSqlFile = vscode_1.l10n.t(
    'To use this command, Open a .sql file -or- Change editor language to "SQL" -or- Select T-SQL text in the active SQL editor.',
);
exports.recentConnectionsPlaceholder = vscode_1.l10n.t(
    "Choose a connection profile from the list below",
);
exports.CreateProfileFromConnectionsListLabel = vscode_1.l10n.t("Create Connection Profile");
exports.CreateProfileLabel = vscode_1.l10n.t("Create a new connection profile");
exports.ClearRecentlyUsedLabel = vscode_1.l10n.t("Clear Recent Connections List");
exports.EditProfilesLabel = vscode_1.l10n.t("Edit an existing connection profile");
exports.RemoveProfileLabel = vscode_1.l10n.t("Remove a connection profile");
exports.ManageProfilesPrompt = vscode_1.l10n.t("Manage Connection Profiles");
exports.SampleServerName = vscode_1.l10n.t("{{put-server-name-here}}");
exports.serverPrompt = vscode_1.l10n.t("Server name or ADO.NET connection string");
exports.serverPlaceholder = vscode_1.l10n.t(
    "hostname\\instance or <server>.database.windows.net or ADO.NET connection string",
);
exports.databasePrompt = vscode_1.l10n.t("Database name");
exports.startIpAddressPrompt = vscode_1.l10n.t("Start IP Address");
exports.endIpAddressPrompt = vscode_1.l10n.t("End IP Address");
exports.firewallRuleNamePrompt = vscode_1.l10n.t("Firewall rule name");
exports.databasePlaceholder = vscode_1.l10n.t(
    "[Optional] Database to connect (press Enter to connect to <default> database)",
);
exports.authTypePrompt = vscode_1.l10n.t("Authentication Type");
exports.authTypeName = vscode_1.l10n.t("authenticationType");
exports.authTypeIntegrated = vscode_1.l10n.t("Integrated");
exports.authTypeSql = vscode_1.l10n.t("SQL Login");
exports.authTypeAzureActiveDirectory = vscode_1.l10n.t(
    "Microsoft Entra Id - Universal w/ MFA Support",
);
exports.authTypeAzureActiveDirectoryDefault = vscode_1.l10n.t("Microsoft Entra Id - Default");
exports.authTypeAzureServicePrincipal = vscode_1.l10n.t("Microsoft Entra Id - Service Principal");
exports.azureAuthTypeCodeGrant = vscode_1.l10n.t("Azure Code Grant");
exports.azureAuthTypeDeviceCode = vscode_1.l10n.t("Azure Device Code");
exports.azureLogChannelName = vscode_1.l10n.t("MSSQL - Azure Auth Logs");
exports.azureConsentDialogOpen = vscode_1.l10n.t("Open");
exports.azureConsentDialogIgnore = vscode_1.l10n.t("Ignore Tenant");
function azureConsentDialogBody(tenantName, tenantId, resource) {
    return vscode_1.l10n.t({
        message:
            "Your tenant '{0} ({1})' requires you to re-authenticate again to access {2} resources. Press Open to start the authentication process.",
        args: [tenantName, tenantId, resource],
        comment: ["{0} is the tenant name", "{1} is the tenant id", "{2} is the resource"],
    });
}
function azureConsentDialogBodyAccount(resource) {
    return vscode_1.l10n.t({
        message:
            "Your account needs re-authentication to access {0} resources. Press Open to start the authentication process.",
        args: [resource],
        comment: ["{0} is the resource"],
    });
}
exports.azureMicrosoftCorpAccount = vscode_1.l10n.t("Microsoft Corp");
exports.azureMicrosoftAccount = vscode_1.l10n.t("Microsoft Entra Account");
function azureNoMicrosoftResource(provider) {
    return vscode_1.l10n.t({
        message: "Provider '{0}' does not have a Microsoft resource endpoint defined.",
        args: [provider],
        comment: ["{0} is the provider"],
    });
}
exports.azureServerCouldNotStart = vscode_1.l10n.t(
    "Server could not start. This could be a permissions error or an incompatibility on your system. You can try enabling device code authentication from settings.",
);
exports.azureAuthNonceError = vscode_1.l10n.t(
    "Authentication failed due to a nonce mismatch, please close Azure Data Studio and try again.",
);
exports.azureAuthStateError = vscode_1.l10n.t(
    "Authentication failed due to a state mismatch, please close ADS and try again.",
);
exports.encryptPrompt = vscode_1.l10n.t("Encrypt");
exports.encryptName = vscode_1.l10n.t("encrypt");
exports.encryptOptional = vscode_1.l10n.t("Optional (False)");
exports.encryptMandatory = vscode_1.l10n.t("Mandatory (True)");
exports.encryptMandatoryRecommended = vscode_1.l10n.t("Mandatory (Recommended)");
exports.enableTrustServerCertificate = vscode_1.l10n.t("Enable Trust Server Certificate");
exports.readMore = vscode_1.l10n.t("Read more");
exports.msgCopyAndOpenWebpage = vscode_1.l10n.t("Copy code and open webpage");
exports.azureChooseAccount = vscode_1.l10n.t("Choose a Microsoft Entra account");
exports.azureAddAccount = vscode_1.l10n.t("Add a Microsoft Entra account...");
function accountAddedSuccessfully(account) {
    return vscode_1.l10n.t({
        message: "Microsoft Entra account {0} successfully added.",
        args: [account],
        comment: ["{0} is the account name"],
    });
}
exports.accountCouldNotBeAdded = vscode_1.l10n.t("New Microsoft Entra account could not be added.");
exports.accountRemovedSuccessfully = vscode_1.l10n.t(
    "Selected Microsoft Entra account removed successfully.",
);
function accountRemovalFailed(error) {
    return vscode_1.l10n.t({
        message: "An error occurred while removing Microsoft Entra account: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
exports.noAzureAccountForRemoval = vscode_1.l10n.t(
    "No Microsoft Entra account can be found for removal.",
);
exports.cannotConnect = vscode_1.l10n.t(
    "Cannot connect due to expired tokens. Please re-authenticate and try again.",
);
exports.aad = vscode_1.l10n.t("Microsoft Entra Id");
exports.azureChooseTenant = vscode_1.l10n.t("Choose a Microsoft Entra tenant");
exports.tenant = vscode_1.l10n.t("Tenant");
exports.usernamePrompt = vscode_1.l10n.t("User name");
exports.usernamePlaceholder = vscode_1.l10n.t("User name (SQL Login)");
exports.passwordPrompt = vscode_1.l10n.t("Password");
exports.passwordPlaceholder = vscode_1.l10n.t("Password (SQL Login)");
exports.msgSavePassword = vscode_1.l10n.t(
    "Save Password? If 'No', password will be required each time you connect",
);
exports.profileNamePrompt = vscode_1.l10n.t("Profile Name");
exports.msgCannotOpenContent = vscode_1.l10n.t("Error occurred opening content in editor.");
function msgSaveStarted(filePath) {
    return vscode_1.l10n.t({
        message: "Started saving results to {0}",
        args: [filePath],
        comment: ["{0} is the file path"],
    });
}
function msgSaveFailed(error) {
    return vscode_1.l10n.t({
        message: "Failed to save results. {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
function msgSaveSucceeded(filePath) {
    return vscode_1.l10n.t({
        message: "Successfully saved results to {0}",
        args: [filePath],
        comment: ["{0} is the file path"],
    });
}
exports.msgSelectProfileToRemove = vscode_1.l10n.t("Select profile to remove");
exports.msgSelectProfileToEdit = vscode_1.l10n.t("Select profile to edit");
exports.confirmRemoveProfilePrompt = vscode_1.l10n.t("Confirm to remove this profile.");
exports.msgNoProfilesToRemove = vscode_1.l10n.t("No connection profiles to remove.");
exports.msgNoProfilesToEdit = vscode_1.l10n.t("No connection profiles to edit.");
exports.msgProfileRemoved = vscode_1.l10n.t("Profile removed successfully");
exports.msgProfileCreated = vscode_1.l10n.t("Profile created successfully");
exports.msgProfileCreatedAndConnected = vscode_1.l10n.t("Profile created and connected");
exports.msgClearedRecentConnections = vscode_1.l10n.t("Recent connections list cleared");
exports.msgIsRequired = vscode_1.l10n.t(" is required.");
exports.msgError = vscode_1.l10n.t("Error: ");
exports.msgYes = vscode_1.l10n.t("Yes");
exports.msgNo = vscode_1.l10n.t("No");
exports.defaultDatabaseLabel = vscode_1.l10n.t("<default>");
exports.connectingTooltip = vscode_1.l10n.t("Connecting to: ");
exports.connectErrorTooltip = vscode_1.l10n.t("Error connecting to: ");
exports.connectErrorCode = vscode_1.l10n.t("Error code: ");
exports.connectErrorMessage = vscode_1.l10n.t("Error Message: ");
exports.cancelingQueryLabel = vscode_1.l10n.t("Canceling query ");
exports.updatingIntelliSenseLabel = vscode_1.l10n.t("Updating IntelliSense...");
exports.extensionNotInitializedError = vscode_1.l10n.t(
    "Unable to execute the command while the extension is initializing. Please try again later.",
);
exports.untitledScheme = vscode_1.l10n.t("untitled");
exports.msgChangeLanguageMode = vscode_1.l10n.t(
    'To use this command, you must set the language to "SQL". Confirm to change language mode.',
);
function msgChangedDatabaseContext(databaseName, documentName) {
    return vscode_1.l10n.t({
        message: 'Changed database context to "{0}" for document "{1}"',
        args: [databaseName, documentName],
        comment: ["{0} is the database name", "{1} is the document name"],
    });
}
exports.msgPromptRetryCreateProfile = vscode_1.l10n.t(
    "Error: Unable to connect using the connection information provided. Retry profile creation?",
);
exports.refreshTokenLabel = vscode_1.l10n.t("Refresh Credentials");
exports.msgGetTokenFail = vscode_1.l10n.t("Failed to fetch user tokens.");
exports.msgPromptRetryConnectionDifferentCredentials = vscode_1.l10n.t(
    "Error: Login failed. Retry using different credentials?",
);
exports.msgPromptRetryFirewallRuleNotSignedIn = vscode_1.l10n.t(
    "Your client IP address does not have access to the server. Add a Microsoft Entra account and create a new firewall rule to enable access.",
);
function msgPromptRetryFirewallRuleSignedIn(clientIp, serverName) {
    return vscode_1.l10n.t({
        message:
            "Your client IP Address '{0}' does not have access to the server '{1}' you're attempting to connect to. Would you like to create new firewall rule?",
        args: [clientIp, serverName],
        comment: ["{0} is the client IP address", "{1} is the server name"],
    });
}
exports.msgPromptRetryFirewallRuleAdded = vscode_1.l10n.t(
    "Firewall rule successfully added. Retry profile creation? ",
);
function msgAccountRefreshFailed(error) {
    if (!error) {
        return vscode_1.l10n.t(
            "Credential Error: An error occurred while attempting to refresh account credentials. Please re-authenticate.",
        );
    } else {
        return vscode_1.l10n.t({
            message:
                "Credential Error: An error occurred while attempting to refresh account credentials. Please re-authenticate. Error: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    }
}
exports.msgPromptProfileUpdateFailed = vscode_1.l10n.t(
    "Connection Profile could not be updated. Please modify the connection details manually in settings.json and try again.",
);
exports.msgUnableToExpand = vscode_1.l10n.t(
    "Unable to expand. Please check logs for more information.",
);
exports.msgPromptFirewallRuleCreated = vscode_1.l10n.t("Firewall rule successfully created.");
exports.msgAuthTypeNotFound = vscode_1.l10n.t(
    "Failed to get authentication method, please remove and re-add the account.",
);
exports.msgAccountNotFound = vscode_1.l10n.t("Account not found");
exports.msgChooseQueryHistory = vscode_1.l10n.t("Choose Query History");
exports.msgChooseQueryHistoryAction = vscode_1.l10n.t("Choose An Action");
exports.msgOpenQueryHistory = vscode_1.l10n.t("Open Query History");
exports.msgRunQueryHistory = vscode_1.l10n.t("Run Query History");
exports.msgInvalidIpAddress = vscode_1.l10n.t("Invalid IP Address");
exports.msgInvalidRuleName = vscode_1.l10n.t("Invalid Firewall rule name");
exports.msgNoQueriesAvailable = vscode_1.l10n.t("No Queries Available");
exports.retryLabel = vscode_1.l10n.t("Retry");
exports.createFirewallRuleLabel = vscode_1.l10n.t("Create Firewall Rule");
function msgConnecting(serverName, documentName) {
    return vscode_1.l10n.t({
        message: 'Connecting to server "{0}" on document "{1}".',
        args: [serverName, documentName],
        comment: ["{0} is the server name", "{1} is the document name"],
    });
}
function msgConnectionNotFound(uri) {
    return vscode_1.l10n.t({
        message: 'Connection not found for uri "{0}".',
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
function msgFoundPendingReconnect(uri) {
    return vscode_1.l10n.t({
        message: "Found pending reconnect promise for uri {0}, waiting.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
function msgPendingReconnectSuccess(uri) {
    return vscode_1.l10n.t({
        message: "Previous pending reconnection for uri {0}, succeeded.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
function msgFoundPendingReconnectFailed(uri) {
    return vscode_1.l10n.t({
        message: "Found pending reconnect promise for uri {0}, failed.",
        args: [uri],
        comment: ["{0} is the uri"],
    });
}
function msgFoundPendingReconnectError(uri, error) {
    return vscode_1.l10n.t({
        message:
            "Previous pending reconnect promise for uri {0} is rejected with error {1}, will attempt to reconnect if necessary.",
        args: [uri, error],
        comment: ["{0} is the uri", "{1} is the error"],
    });
}
function msgAcessTokenExpired(connectionId, uri) {
    return vscode_1.l10n.t({
        message: "Access token expired for connection {0} with uri {1}",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
exports.msgRefreshTokenError = vscode_1.l10n.t("Error when refreshing token");
exports.msgAzureCredStoreSaveFailedError = vscode_1.l10n.t(
    'Keys for token cache could not be saved in credential store, this may cause Microsoft Entra Id access token persistence issues and connection instabilities. It\'s likely that SqlTools has reached credential storage limit on Windows, please clear at least 2 credentials that start with "Microsoft.SqlTools|" in Windows Credential Manager and reload.',
);
function msgRefreshConnection(connectionId, uri) {
    return vscode_1.l10n.t({
        message: "Failed to refresh connection ${0} with uri {1}, invalid connection result.",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
function msgRefreshTokenSuccess(connectionId, uri, message) {
    return vscode_1.l10n.t({
        message: "Successfully refreshed token for connection {0} with uri {1}, {2}",
        args: [connectionId, uri, message],
        comment: ["{0} is the connection id", "{1} is the uri", "{2} is the message"],
    });
}
function msgRefreshTokenNotNeeded(connectionId, uri) {
    return vscode_1.l10n.t({
        message:
            "No need to refresh Microsoft Entra acccount token for connection {0} with uri {1}",
        args: [connectionId, uri],
        comment: ["{0} is the connection id", "{1} is the uri"],
    });
}
function msgConnectedServerInfo(serverName, documentName, serverInfo) {
    return vscode_1.l10n.t({
        message: 'Connected to server "{0}" on document "{1}". Server information: {2}',
        args: [serverName, documentName, serverInfo],
        comment: ["{0} is the server name", "{1} is the document name", "{2} is the server info"],
    });
}
function msgConnectionFailed(serverName, errorMessage) {
    return vscode_1.l10n.t({
        message: 'Error connecting to server "{0}". Details: {1}',
        args: [serverName, errorMessage],
        comment: ["{0} is the server name", "{1} is the error message"],
    });
}
function msgChangingDatabase(databaseName, serverName, documentName) {
    return vscode_1.l10n.t({
        message: 'Changing database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: ["{0} is the database name", "{1} is the server name", "{2} is the document name"],
    });
}
function msgChangedDatabase(databaseName, serverName, documentName) {
    return vscode_1.l10n.t({
        message: 'Changed database context to "{0}" on server "{1}" on document "{2}".',
        args: [databaseName, serverName, documentName],
        comment: ["{0} is the database name", "{1} is the server name", "{2} is the document name"],
    });
}
function msgDisconnected(documentName) {
    return vscode_1.l10n.t({
        message: 'Disconnected on document "{0}"',
        args: [documentName],
        comment: ["{0} is the document name"],
    });
}
exports.help = vscode_1.l10n.t("Help");
exports.macSierraRequiredErrorMessage = vscode_1.l10n.t(
    "macOS Sierra or newer is required to use this feature.",
);
exports.gettingDefinitionMessage = vscode_1.l10n.t("Getting definition ...");
exports.definitionRequestedStatus = vscode_1.l10n.t("DefinitionRequested");
exports.definitionRequestCompletedStatus = vscode_1.l10n.t("DefinitionRequestCompleted");
exports.updatingIntelliSenseStatus = vscode_1.l10n.t("updatingIntelliSense");
exports.intelliSenseUpdatedStatus = vscode_1.l10n.t("intelliSenseUpdated");
exports.testLocalizationConstant = vscode_1.l10n.t("test");
exports.disconnectOptionLabel = vscode_1.l10n.t("Disconnect");
exports.disconnectOptionDescription = vscode_1.l10n.t("Close the current connection");
exports.disconnectConfirmationMsg = vscode_1.l10n.t("Are you sure you want to disconnect?");
function elapsedBatchTime(batchTime) {
    return vscode_1.l10n.t({
        message: "Batch execution time: {0}",
        args: [batchTime],
        comment: ["{0} is the batch time"],
    });
}
exports.noActiveEditorMsg = vscode_1.l10n.t(
    "A SQL editor must have focus before executing this command",
);
exports.maximizeLabel = vscode_1.l10n.t("Maximize");
exports.restoreLabel = vscode_1.l10n.t("Restore");
exports.saveCSVLabel = vscode_1.l10n.t("Save as CSV");
exports.saveJSONLabel = vscode_1.l10n.t("Save as JSON");
exports.saveExcelLabel = vscode_1.l10n.t("Save as Excel");
exports.fileTypeCSVLabel = vscode_1.l10n.t("CSV");
exports.fileTypeJSONLabel = vscode_1.l10n.t("JSON");
exports.fileTypeExcelLabel = vscode_1.l10n.t("Excel");
exports.fileTypeAllFilesLabel = vscode_1.l10n.t("All files");
exports.resultPaneLabel = vscode_1.l10n.t("Results");
exports.selectAll = vscode_1.l10n.t("Select all");
exports.copyLabel = vscode_1.l10n.t("Copy");
exports.copyWithHeadersLabel = vscode_1.l10n.t("Copy with Headers");
exports.executeQueryLabel = vscode_1.l10n.t("Executing query...");
exports.QueryExecutedLabel = vscode_1.l10n.t("Query executed");
exports.messagePaneLabel = vscode_1.l10n.t("Messages");
exports.messagesTableTimeStampColumn = vscode_1.l10n.t("Timestamp");
exports.messagesTableMessageColumn = vscode_1.l10n.t("Message");
function lineSelectorFormatted(lineNumber) {
    return vscode_1.l10n.t({
        message: "Line {0}",
        args: [lineNumber],
        comment: ["{0} is the line number"],
    });
}
function elapsedTimeLabel(elapsedTime) {
    return vscode_1.l10n.t({
        message: "Total execution time: {0}",
        args: [elapsedTime],
        comment: ["{0} is the elapsed time"],
    });
}
exports.msgCannotSaveMultipleSelections = vscode_1.l10n.t(
    "Save results command cannot be used with multiple selections.",
);
exports.mssqlProviderName = vscode_1.l10n.t("MSSQL");
exports.noneProviderName = vscode_1.l10n.t("None");
exports.flavorChooseLanguage = vscode_1.l10n.t("Choose SQL Language");
exports.flavorDescriptionMssql = vscode_1.l10n.t(
    "Use T-SQL intellisense and syntax error checking on current document",
);
exports.flavorDescriptionNone = vscode_1.l10n.t(
    "Disable intellisense and syntax error checking on current document",
);
exports.autoDisableNonTSqlLanguageServicePrompt = vscode_1.l10n.t(
    "Non-SQL Server SQL file detected. Disable IntelliSense for such files?",
);
exports.msgAddConnection = vscode_1.l10n.t("Add Connection");
exports.msgConnect = vscode_1.l10n.t("Connect");
exports.azureSignIn = vscode_1.l10n.t("Azure: Sign In");
exports.azureSignInDescription = vscode_1.l10n.t("Sign in to your Azure subscription");
exports.azureSignInWithDeviceCode = vscode_1.l10n.t("Azure: Sign In with Device Code");
exports.azureSignInWithDeviceCodeDescription = vscode_1.l10n.t(
    "Sign in to your Azure subscription with a device code. Use this in setups where the Sign In command does not work",
);
exports.azureSignInToAzureCloud = vscode_1.l10n.t("Azure: Sign In to Azure Cloud");
exports.azureSignInToAzureCloudDescription = vscode_1.l10n.t(
    "Sign in to your Azure subscription in one of the sovereign clouds.",
);
exports.noBackgroundTasks = vscode_1.l10n.t("No background tasks");
function backgroundTaskName(taskName) {
    return vscode_1.l10n.t({
        message: "Task: {0}",
        args: [taskName],
        comment: ["{0} is the task name"],
    });
}
function backgroundTaskDescription(description) {
    return vscode_1.l10n.t({
        message: "Description: {0}",
        args: [description],
        comment: ["{0} is the task description"],
    });
}
function backgroundTaskStatus(status) {
    return vscode_1.l10n.t({
        message: "Status: {0}",
        args: [status],
        comment: ["{0} is the task status"],
    });
}
function backgroundTaskSource(source) {
    return vscode_1.l10n.t({
        message: "Source: {0}",
        args: [source],
        comment: ["{0} is the task source"],
    });
}
function backgroundTaskConnection(connectionLabel) {
    return vscode_1.l10n.t({
        message: "Connection: {0}",
        args: [connectionLabel],
        comment: ["{0} is the task connection label"],
    });
}
function backgroundTaskTarget(targetLocation) {
    return vscode_1.l10n.t({
        message: "Target: {0}",
        args: [targetLocation],
        comment: ["{0} is the task target location"],
    });
}
function backgroundTaskElapsedTime(elapsedTime) {
    return vscode_1.l10n.t({
        message: "Elapsed time: {0}",
        args: [elapsedTime],
        comment: ["{0} is the task elapsed time"],
    });
}
exports.backgroundTaskLogsHeader = vscode_1.l10n.t("Logs");
exports.backgroundTaskNoLogEntries = vscode_1.l10n.t("No log entries yet.");
exports.backgroundTaskLogUnavailable = vscode_1.l10n.t("Task log is unavailable.");
exports.backgroundTaskCancelConfirmation = vscode_1.l10n.t(
    "Are you sure you want to cancel this background task?",
);
exports.backgroundTaskCancelConfirm = vscode_1.l10n.t("Cancel Task");
function backgroundTaskLogLine(timestamp, entry) {
    return vscode_1.l10n.t({
        message: "[{0}] {1}",
        args: [timestamp, entry],
        comment: ["{0} is the timestamp", "{1} is the log entry text"],
    });
}
function backgroundTaskLogStateWithMessage(status, message) {
    return vscode_1.l10n.t({
        message: "{0}: {1}",
        args: [status, message],
        comment: ["{0} is the task status", "{1} is the task message"],
    });
}
function backgroundTaskLogStateWithProgress(status, percent) {
    return vscode_1.l10n.t({
        message: "{0} ({1}%)",
        args: [status, percent],
        comment: ["{0} is the task status", "{1} is the completion percent"],
    });
}
function backgroundTaskLogStateWithProgressAndMessage(status, percent, message) {
    return vscode_1.l10n.t({
        message: "{0} ({1}%): {2}",
        args: [status, percent, message],
        comment: [
            "{0} is the task status",
            "{1} is the completion percent",
            "{2} is the task message",
        ],
    });
}
function backgroundTaskElapsedMilliseconds(milliseconds) {
    return vscode_1.l10n.t({
        message: "{0}ms",
        args: [milliseconds],
        comment: ["{0} is the elapsed time in milliseconds"],
    });
}
function backgroundTaskElapsedSeconds(seconds) {
    return vscode_1.l10n.t({
        message: "{0}s",
        args: [seconds],
        comment: ["{0} is the elapsed time in seconds"],
    });
}
function backgroundTaskElapsedMinutesAndSeconds(minutes, seconds) {
    return vscode_1.l10n.t({
        message: "{0}m {1}s",
        args: [minutes, seconds],
        comment: [
            "{0} is the elapsed time in minutes",
            "{1} is the remaining elapsed time in seconds",
        ],
    });
}
function backgroundTaskElapsedHoursAndMinutes(hours, minutes) {
    return vscode_1.l10n.t({
        message: "{0}h {1}m",
        args: [hours, minutes],
        comment: [
            "{0} is the elapsed time in hours",
            "{1} is the remaining elapsed time in minutes",
        ],
    });
}
function backgroundTaskElapsedDaysAndHours(days, hours) {
    return vscode_1.l10n.t({
        message: "{0}d {1}h",
        args: [days, hours],
        comment: ["{0} is the elapsed time in days", "{1} is the remaining elapsed time in hours"],
    });
}
function taskStatusWithName(taskName, status) {
    return vscode_1.l10n.t({
        message: "{0}: {1}",
        args: [taskName, status],
        comment: ["{0} is the task name", "{1} is the status"],
    });
}
function taskStatusWithMessage(status, message) {
    return vscode_1.l10n.t({
        message: "{0}. {1}",
        args: [status, message],
        comment: ["{0} is the status", "{1} is the message"],
    });
}
function taskStatusWithNameAndMessage(taskName, status, message) {
    return vscode_1.l10n.t({
        message: "{0}: {1}. {2}",
        args: [taskName, status, message],
        comment: ["{0} is the task name", "{1} is the status", "{2} is the message"],
    });
}
exports.failed = vscode_1.l10n.t("Failed");
exports.succeeded = vscode_1.l10n.t("Succeeded");
exports.succeededWithWarning = vscode_1.l10n.t("Succeeded with warning");
exports.canceled = vscode_1.l10n.t("Canceled");
exports.inProgress = vscode_1.l10n.t("In progress");
exports.canceling = vscode_1.l10n.t("Canceling");
exports.notStarted = vscode_1.l10n.t("Not started");
exports.nodeErrorMessage = vscode_1.l10n.t("Parent node was not TreeNodeInfo.");
function deleteCredentialError(id, error) {
    return vscode_1.l10n.t({
        message: "Failed to delete credential with id: {0}. {1}",
        args: [id, error],
        comment: ["{0} is the id", "{1} is the error"],
    });
}
exports.msgClearedRecentConnectionsWithErrors = vscode_1.l10n.t(
    "The recent connections list has been cleared but there were errors while deleting some associated credentials. View the errors in the MSSQL output channel.",
);
exports.connectProgressNoticationTitle = vscode_1.l10n.t("Testing connection profile...");
exports.msgMultipleSelectionModeNotSupported = vscode_1.l10n.t(
    "Running query is not supported when the editor is in multiple selection mode.",
);
exports.msgNoQueryTextToExecute = vscode_1.l10n.t(
    "There is no query text to execute. Enter a query or select non-empty query text.",
);
exports.msgSelectNodeToScript = vscode_1.l10n.t(
    "Please select a node from Object Explorer to script.",
);
exports.msgSelectSingleNodeToScript = vscode_1.l10n.t(
    "Please select only one node to script. Multiple node scripting is not supported.",
);
function msgScriptingObjectNotFound(nodeType, nodeLabel) {
    return vscode_1.l10n.t({
        message: "Could not find scripting metadata for {0} '{1}'.",
        args: [nodeType, nodeLabel],
        comment: ["{0} is the node type", "{1} is the node label"],
    });
}
exports.msgScriptingFailed = vscode_1.l10n.t(
    "Failed to generate script. Please check the logs for more details.",
);
exports.msgScriptingEditorFailed = vscode_1.l10n.t("Failed to open script in editor.");
exports.msgNoScriptGenerated = vscode_1.l10n.t("No script generated.");
exports.msgObjectManagementUnknownDialog = vscode_1.l10n.t("Unknown object management dialog.");
function msgScriptingOperationFailed(error) {
    return vscode_1.l10n.t({
        message: "Failed to generate script: {0}",
        args: [error],
        comment: ["{0} is the error message"],
    });
}
exports.newColumnWidthPrompt = vscode_1.l10n.t("Enter new column width");
exports.columnWidthInvalidNumberError = vscode_1.l10n.t("Invalid column width");
exports.columnWidthMustBePositiveError = vscode_1.l10n.t("Width cannot be 0 or negative");
exports.objectExplorerNodeRefreshError = vscode_1.l10n.t(
    "An error occurred refreshing nodes. See the MSSQL output channel for more details.",
);
exports.showOutputChannelActionButtonText = vscode_1.l10n.t("Show MSSQL output");
exports.reloadPrompt = vscode_1.l10n.t(
    "Authentication Library has changed, please reload Visual Studio Code.",
);
exports.reloadPromptGeneric = vscode_1.l10n.t(
    "Visual Studio Code must be relaunched for this setting to come into effect.  Please reload Visual Studio Code.",
);
exports.reloadChoice = vscode_1.l10n.t("Reload Visual Studio Code");
exports.switchToMsal = vscode_1.l10n.t("Switch to MSAL");
exports.dismiss = vscode_1.l10n.t("Dismiss");
exports.querySuccess = vscode_1.l10n.t("Query succeeded");
exports.queryFailed = vscode_1.l10n.t("Query failed");
exports.parameters = vscode_1.l10n.t("Parameters");
exports.loading = vscode_1.l10n.t("Loading");
exports.executionPlan = vscode_1.l10n.t("Execution Plan");
exports.executionPlanFileFilter = vscode_1.l10n.t("SQL Plan Files");
exports.scriptCopiedToClipboard = vscode_1.l10n.t("Script copied to clipboard");
exports.copied = vscode_1.l10n.t("Copied");
let failedToOpenTextInEditor = (errorMessage) =>
    vscode_1.l10n.t({
        message: "Failed to open text in editor: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
exports.failedToOpenTextInEditor = failedToOpenTextInEditor;
let failedToCopyTextToClipboard = (errorMessage) =>
    vscode_1.l10n.t({
        message: "Failed to copy text to clipboard: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
exports.failedToCopyTextToClipboard = failedToCopyTextToClipboard;
let failedToAddTextToWorkspace = (errorMessage) =>
    vscode_1.l10n.t({
        message: "Failed to add text to workspace: {0}",
        args: [errorMessage],
        comment: ["{0} is the error message"],
    });
exports.failedToAddTextToWorkspace = failedToAddTextToWorkspace;
exports.schemaDesignerDetailsUnavailable = vscode_1.l10n.t(
    "Schema designer details are not available.",
);
exports.copyingResults = vscode_1.l10n.t("Copying results...");
exports.openQueryResultsInTabByDefaultPrompt = vscode_1.l10n.t(
    "Do you want to always display query results in a new tab instead of the query pane?",
);
exports.alwaysShowInNewTab = vscode_1.l10n.t("Always show in new tab");
exports.keepInQueryPane = vscode_1.l10n.t("Keep in query pane");
exports.inMemoryDataProcessingThresholdExceeded = vscode_1.l10n.t(
    "Max row count for filtering/sorting has been exceeded. To update it, navigate to User Settings and change the setting: mssql.resultsGrid.inMemoryDataProcessingThreshold",
);
exports.newDeployment = vscode_1.l10n.t("New Deployment");
exports.noWorkspaceOpenForDeploymentScript = vscode_1.l10n.t(
    "No workspace folder is open. Open a folder to add the deployment script.",
);
let deploymentScriptAlreadyExists = (fileName) =>
    vscode_1.l10n.t({
        message: "A file named '{0}' already exists in the workspace root.",
        args: [fileName],
        comment: ["{0} is the deployment script file name"],
    });
exports.deploymentScriptAlreadyExists = deploymentScriptAlreadyExists;
exports.overwriteDeploymentScript = vscode_1.l10n.t("Overwrite");
class Notebooks {
    // Status bar
    static statusBarClickToChangeConnection = vscode_1.l10n.t("MSSQL: Click to change connection");
    static statusBarClickToChangeDatabase = vscode_1.l10n.t("MSSQL: Click to change database");
    static selectionSummaryStatusBarName = vscode_1.l10n.t("MSSQL Notebook Selection Summary");
    // Errors
    static connectionFailed = vscode_1.l10n.t("Connection failed");
    static queryExecutionFailed = vscode_1.l10n.t("Query execution failed");
    static noActiveNotebook = vscode_1.l10n.t("No active notebook.");
    static noActiveConnection = vscode_1.l10n.t("No active connection.");
    static noConnectionSelected = vscode_1.l10n.t("No connection selected.");
    // Copy cell output
    static copyMessages = vscode_1.l10n.t("Copy messages");
    static copyMessagesTooltip = vscode_1.l10n.t(
        "Copy all text output for this cell (messages, PRINT, errors)",
    );
    static copiedMessages = vscode_1.l10n.t("$(check) Copied messages");
    // Execution results
    static rowsAffected(count) {
        return vscode_1.l10n.t({
            message: "({0} row(s) affected)",
            args: [count],
            comment: ["{0} is the number of rows affected"],
        });
    }
    static commandCompletedSuccessfully = vscode_1.l10n.t("(Command completed successfully)");
    static zeroRows = vscode_1.l10n.t("(0 rows)");
    static resultSetTruncated(actual, expected) {
        return vscode_1.l10n.t({
            message:
                "Warning: Result set is incomplete. Showing {0} of {1} rows. The full result set could not be loaded.",
            args: [actual, expected],
            comment: [
                "{0} is the number of rows actually returned",
                "{1} is the total number of rows expected",
            ],
        });
    }
    static rowCountPlain(count) {
        if (count === 1) {
            return vscode_1.l10n.t({
                message: "({0} row)",
                args: [count],
                comment: ["{0} is the number of rows (singular)"],
            });
        }
        return vscode_1.l10n.t({
            message: "({0} rows)",
            args: [count],
            comment: ["{0} is the number of rows (plural)"],
        });
    }
    // Magic commands
    static disconnected = vscode_1.l10n.t("Disconnected.");
    static connectedTo(label) {
        return vscode_1.l10n.t({
            message: "Connected to {0}",
            args: [label],
            comment: ["{0} is the connection label"],
        });
    }
    static switchedTo(label) {
        return vscode_1.l10n.t({
            message: "Switched to {0}",
            args: [label],
            comment: ["{0} is the connection label"],
        });
    }
    static noDatabaseSelected = vscode_1.l10n.t("No database selected.");
    static unknownMagicCommand(cmd) {
        return vscode_1.l10n.t({
            message: "Unknown magic command: %%{0}",
            args: [cmd],
            comment: ["{0} is the magic command name"],
        });
    }
    // UI
    static selectDatabase = vscode_1.l10n.t("Select Database");
    static chooseDatabasePlaceholder = vscode_1.l10n.t("Choose a database");
    static currentDatabaseLabel = vscode_1.l10n.t("(current)");
    // Code lens
    static codeLensClickToChangeConnection = vscode_1.l10n.t("Click to change connection");
    static codeLensClickToChangeDatabase = vscode_1.l10n.t("Click to change database");
    static codeLensConnectToSqlServer = vscode_1.l10n.t("Connect to SQL Server");
    // Info
    static notebookConnectedTo(label) {
        return vscode_1.l10n.t({
            message: "MSSQL Notebook connected to {0}",
            args: [label],
            comment: ["{0} is the connection label"],
        });
    }
    static errorPrefix(msg) {
        return vscode_1.l10n.t({
            message: "Error: {0}",
            args: [msg],
            comment: ["{0} is the error message"],
        });
    }
    // Cancellation
    static executionCanceled = vscode_1.l10n.t("Query execution was canceled.");
    // Controller
    static controllerDescription = vscode_1.l10n.t("Execute SQL against SQL Server / Azure SQL");
    // General
    static notConnected = vscode_1.l10n.t("Not connected");
    // Renderer
    static parseError = vscode_1.l10n.t("Error: Failed to parse query result data.");
    // Save as
    static saveAsCsvDialogTitle = vscode_1.l10n.t("Save results as CSV");
    static saveAsExcelDialogTitle = vscode_1.l10n.t("Save results as Excel");
    static saveAsJsonDialogTitle = vscode_1.l10n.t("Save results as JSON");
    static saveResultsFailed(message) {
        return vscode_1.l10n.t({
            message: "Failed to save results: {0}",
            args: [message],
            comment: ["{0} is the underlying error message"],
        });
    }
    static savedResultsTo(uri) {
        return vscode_1.l10n.t({
            message: "Saved results to {0}",
            args: [uri],
            comment: ["{0} is the saved file path"],
        });
    }
}
exports.Notebooks = Notebooks;
class ObjectExplorer {
    static ErrorLoadingRefreshToTryAgain = vscode_1.l10n.t("Error loading; refresh to try again");
    static NoItems = vscode_1.l10n.t("No items");
    static FailedOEConnectionError = vscode_1.l10n.t(
        "We couldn't connect using the current connection information. Would you like to retry the connection or edit the connection profile?",
    );
    static FailedOEConnectionErrorRetry = vscode_1.l10n.t("Retry");
    static FailedOEConnectionErrorUpdate = vscode_1.l10n.t("Edit connection profile");
    static FailedOEConnectionErrorSignIn = vscode_1.l10n.t("Sign in and retry");
    static Connecting = vscode_1.l10n.t("Connecting...");
    static ResumingDatabase = vscode_1.l10n.t("Resuming database");
    static NodeDeletionConfirmation(nodeLabel) {
        return vscode_1.l10n.t({
            message: "Are you sure you want to remove {0}?",
            args: [nodeLabel],
            comment: ["{0} is the node label"],
        });
    }
    static NodeDeletionConfirmationYes = vscode_1.l10n.t("Yes");
    static NodeDeletionConfirmationNo = vscode_1.l10n.t("No");
    static LoadingNodeLabel = vscode_1.l10n.t("Loading...");
    static GeneratingScript = vscode_1.l10n.t("Generating script...");
    static FetchingScriptLabel(scriptType) {
        return vscode_1.l10n.t({
            message: "Fetching {0} script...",
            args: [scriptType],
            comment: ["{0} is the script type"],
        });
    }
    static ScriptSelectLabel = vscode_1.l10n.t("Select");
    static ScriptCreateLabel = vscode_1.l10n.t("Create");
    static ScriptInsertLabel = vscode_1.l10n.t("Insert");
    static ScriptUpdateLabel = vscode_1.l10n.t("Update");
    static ScriptDeleteLabel = vscode_1.l10n.t("Delete");
    static ScriptExecuteLabel = vscode_1.l10n.t("Execute");
    static ScriptAlterLabel = vscode_1.l10n.t("Alter");
    static AzureSignInMessage(accountName) {
        return vscode_1.l10n.t({
            message: "Signing in to Azure as {0}...",
            args: [accountName],
            comment: ["{0} is the account name"],
        });
    }
    static ConnectionGroupDeletionConfirmationWithContents(groupName) {
        return vscode_1.l10n.t({
            message:
                "Are you sure you want to delete {0}?  You can delete its connections as well, or move them to the root folder.",
            args: [groupName],
            comment: ["{0} is the group name"],
        });
    }
    static ConnectionGroupDeleteContents = vscode_1.l10n.t("Delete Contents");
    static ConnectionGroupMoveContents = vscode_1.l10n.t("Move to Root");
    static ConnectionGroupDeletionConfirmationWithoutContents(groupName) {
        return vscode_1.l10n.t({
            message: "Are you sure you want to delete {0}?",
            args: [groupName],
            comment: ["{0} is the group name"],
        });
    }
    static ConnectionStringCopied = vscode_1.l10n.t("Connection string copied to clipboard");
}
exports.ObjectExplorer = ObjectExplorer;
class ConnectionDialog {
    static connectionDialog = vscode_1.l10n.t("Connection Dialog");
    static microsoftAccount = vscode_1.l10n.t("Microsoft Account");
    static microsoftAccountIsRequired = vscode_1.l10n.t("Microsoft Account is required");
    static selectAnAccount = vscode_1.l10n.t("Select an account");
    static addAccount = vscode_1.l10n.t("Add account");
    static savePassword = vscode_1.l10n.t("Save Password");
    static tenantId = vscode_1.l10n.t("Tenant ID");
    static selectATenant = vscode_1.l10n.t("Select a tenant");
    static tenantIdIsRequired = vscode_1.l10n.t("Tenant ID is required");
    static profileName = vscode_1.l10n.t("Profile Name");
    static profileNamePlaceholder = vscode_1.l10n.t("Enter profile name");
    static profileNameTooltip = vscode_1.l10n.t(
        "[Optional] Enter a display name for this connection profile",
    );
    static connectionGroup = vscode_1.l10n.t("Connection Group");
    static serverIsRequired = vscode_1.l10n.t("Server is required");
    static usernameIsRequired = vscode_1.l10n.t("User name is required");
    static connectionString = vscode_1.l10n.t("Connection String");
    static connectionStringIsRequired = vscode_1.l10n.t("Connection string is required");
    static signIn = vscode_1.l10n.t("Sign in");
    static additionalParameters = vscode_1.l10n.t("Additional parameters");
    static connect = vscode_1.l10n.t("Connect");
    static default = vscode_1.l10n.t("<Default>");
    static entraDefaultAuthTooltip = vscode_1.l10n.t(
        "Automatically selects an available Microsoft Entra ID identity from providers installed on your system. Click the info icon to learn more.",
    );
    static entraMfaAuthTooltip = vscode_1.l10n.t(
        "Sign in with your Microsoft Entra ID account, including accounts with multi-factor authentication. Click the info icon to learn more.",
    );
    static entraServicePrincipalAuthTooltip = vscode_1.l10n.t(
        "Authenticate using a Microsoft Entra service principal. Enter the Application (client) ID as the user name and the client secret as the password. Click the info icon to learn more.",
    );
    static applicationClientId = vscode_1.l10n.t("Application (Client) ID");
    static applicationClientIdTooltip = vscode_1.l10n.t(
        "The Application (Client) ID of your Microsoft Entra app registration.",
    );
    static clientSecret = vscode_1.l10n.t("Client Secret");
    static clientSecretTooltip = vscode_1.l10n.t(
        "The client secret for your Microsoft Entra app registration.",
    );
    static applicationClientIdIsRequired = vscode_1.l10n.t("Application (Client) ID is required.");
    static clientSecretIsRequired = vscode_1.l10n.t("Client secret is required.");
    static saveSecret = vscode_1.l10n.t("Save Secret");
    static createConnectionGroup = vscode_1.l10n.t("+ Create Connection Group");
    static selectConnectionGroup = vscode_1.l10n.t("Select a connection group");
    static searchConnectionGroups = vscode_1.l10n.t("Search connection groups");
    static errorLoadingAzureDatabases(subscriptionName, subscriptionId) {
        return vscode_1.l10n.t({
            message:
                "Error loading Azure databases for subscription {0} ({1}).  Confirm that you have permission.",
            args: [subscriptionName, subscriptionId],
            comment: ["{0} is the subscription name", "{1} is the subscription id"],
        });
    }
    static deleteTheSavedConnection = (connectionName) => {
        return vscode_1.l10n.t({
            message: "delete the saved connection: {0}?",
            args: [connectionName],
            comment: ["{0} is the connection name"],
        });
    };
    static multipleMatchingTokensError(accountDisplayName, tenantId) {
        if (!accountDisplayName || !tenantId) {
            return vscode_1.l10n.t(
                "Authentication error for account. Resolving this requires clearing your token cache, which will sign you out of all connected accounts.",
            );
        }
        return vscode_1.l10n.t({
            message:
                "Authentication error for account '{0}' (tenant '{1}'). Resolving this requires clearing your token cache, which will sign you out of all connected accounts.",
            args: [accountDisplayName, tenantId],
            comment: ["{0} is the account display name", "{1} is the tenant id"],
        });
    }
    static clearCacheAndRefreshToken = vscode_1.l10n.t("Clear cache and refresh token");
    static clearTokenCache = vscode_1.l10n.t("Clear token cache");
    static tokenRefreshedSuccessfully = vscode_1.l10n.t("Token refreshed successfully.");
    static unableToAcquireValidToken(expiresOn, currentTime) {
        return vscode_1.l10n.t({
            message: "Unable to acquire a valid token. (expires: {0}, but is currently {1})",
            args: [expiresOn, currentTime],
            comment: ["{0} is the token expiration time", "{1} is the current time"],
        });
    }
    static errorRefreshingToken(errorMessage) {
        return vscode_1.l10n.t({
            message: "Error refreshing token; you may need to sign out and sign back in: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    static errorValidatingEntraToken(errorMessage) {
        return vscode_1.l10n.t({
            message:
                "Error validating Entra authentication token; you may need to refresh your token: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    static noWorkspacesFound = vscode_1.l10n.t(
        "No workspaces found. Please change Fabric account or tenant to view available workspaces.",
    );
    static noSubscriptionsFound = vscode_1.l10n.t(
        "No subscriptions found. Please change Azure account or tenant to view available subscriptions.",
    );
    static selectDatabase = vscode_1.l10n.t("Select a database");
    static userDatabasesGroup = vscode_1.l10n.t("User databases");
    static systemDatabasesGroup = vscode_1.l10n.t("System databases");
    static unableToLoadDatabaseList(errorMessage) {
        return vscode_1.l10n.t({
            message:
                "Unable to load database list from server: {0} You may enter the database name directly.",
            args: [errorMessage],
            comment: ["{0} is the connection error message"],
        });
    }
    static unsupportedAuthType(authenticationType) {
        return vscode_1.l10n.t({
            message:
                "Unsupported authentication type in connection string: {0}. Only SQL Login, Integrated, Azure MFA, and Active Directory Default authentication are supported.",
            args: [authenticationType],
            comment: ["{0} is the authentication type"],
        });
    }
}
exports.ConnectionDialog = ConnectionDialog;
class FirewallRule {
    static addFirewallRule = vscode_1.l10n.t("Add Firewall Rule");
    static addFirewallRuleToServer = (serverName) => {
        return vscode_1.l10n.t({
            message: "Add Firewall Rule to {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
}
exports.FirewallRule = FirewallRule;
class Azure {
    static unableToAcquireEntraTokenFromVsCode(accountDisplayName) {
        return vscode_1.l10n.t({
            message:
                "Unable to acquire a Microsoft Entra token from VS Code for the selected account: {0}",
            args: [accountDisplayName],
            comment: ["{0} is the account label or ID"],
        });
    }
    static noResourceConfiguredForCurrentCloud(resourceType, cloudName) {
        return vscode_1.l10n.t({
            message:
                "No resource of type '{0}' is configured for the current cloud '{1}'. Please update your Azure account settings.",
            args: [resourceType, cloudName],
            comment: ["{0} is the resource type", "{1} is the display name of the current cloud"],
        });
    }
    static accountNotFound(accountDisplayName) {
        return vscode_1.l10n.t({
            message:
                "Azure account '{0}' was not found. Sign in with the correct account or select a different one.",
            args: [accountDisplayName],
            comment: ["{0} is the display name or ID of the Azure account that was not found"],
        });
    }
    static errorSigningIntoAzure(errorMessage) {
        return vscode_1.l10n.t({
            message: "Error signing into Azure: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    static errorLoadingAzureAccountInfoForTenantId = (tenantId) => {
        return vscode_1.l10n.t({
            message: "Error loading Azure account information for tenant ID '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };
    static errorCreatingFirewallRule = (ruleInfo, error) => {
        return vscode_1.l10n.t({
            message:
                "Error creating firewall rule {0}.  Check your Azure account settings and try again.  Error: {1}",
            args: [ruleInfo, error],
            comment: [
                "{0} is the rule info in format 'name (startIp - endIp)'",
                "{1} is the error message",
            ],
        });
    };
    static unableToLocateSqlServer = (serverName) => {
        return vscode_1.l10n.t({
            message: "Unable to locate Azure SQL server '{0}' in the selected Azure account.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    static failedToGetTenantForAccount = (tenantId, accountName) => {
        return vscode_1.l10n.t({
            message: "Failed to get tenant '{0}' for account '{1}'.",
            args: [tenantId, accountName],
            comment: ["{0} is the tenant id", "{1} is the account name"],
        });
    };
    static PublicCloud = vscode_1.l10n.t("Azure (Public)");
    static USGovernmentCloud = vscode_1.l10n.t("Azure (US Government)");
    static ChinaCloud = vscode_1.l10n.t("Azure (China)");
    static customCloudNotConfigured = (missingSetting) => {
        return vscode_1.l10n.t(
            "The custom cloud choice is not configured. Please configure the setting `{0}`.",
            missingSetting,
        );
    };
}
exports.Azure = Azure;
class Fabric {
    static failedToGetWorkspacesForTenant = (tenantName, tenantId, errorMessage) => {
        if (errorMessage) {
            return vscode_1.l10n.t({
                message: "Failed to get Fabric workspaces for tenant '{0} ({1})': {2}",
                args: [tenantName, tenantId, errorMessage],
                comment: [
                    "{0} is the tenant name",
                    "{1} is the tenant id",
                    "{2} is the error message",
                ],
            });
        } else {
            return vscode_1.l10n.t({
                message: "Failed to get Fabric workspaces for tenant '{0} ({1})'.",
                args: [tenantName, tenantId],
                comment: ["{0} is the tenant name", "{1} is the tenant id"],
            });
        }
    };
    static listingCapacitiesForTenant = (tenantId) => {
        return vscode_1.l10n.t({
            message: "Listing Fabric capacities for tenant '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };
    static listingWorkspacesForTenant = (tenantId) => {
        return vscode_1.l10n.t({
            message: "Listing Fabric workspaces for tenant '{0}'",
            args: [tenantId],
            comment: ["{0} is the tenant ID"],
        });
    };
    static gettingWorkspace = (workspaceId) => {
        return vscode_1.l10n.t({
            message: "Getting Fabric workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };
    static listingSqlDatabasesForWorkspace = (workspaceId) => {
        return vscode_1.l10n.t({
            message: "Listing Fabric SQL Databases for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };
    static listingSqlEndpointsForWorkspace = (workspaceId) => {
        return vscode_1.l10n.t({
            message: "Listing Fabric SQL Endpoints for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };
    static listingWarehousesForWorkspace = (workspaceId) => {
        return vscode_1.l10n.t({
            message: "Listing Fabric Warehouses for workspace '{0}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };
    static gettingConnectionStringForSqlEndpoint = (sqlEndpointId, workspaceId) => {
        return vscode_1.l10n.t({
            message: "Getting connection string for SQL Endpoint '{0}' in workspace '{1}'",
            args: [sqlEndpointId, workspaceId],
            comment: ["{0} is the SQL endpoint ID", "{1} is the workspace ID"],
        });
    };
    static createWorkspaceWithCapacity = (capacityId) => {
        return vscode_1.l10n.t({
            message: "Creating workspace with capacity {0}",
            args: [capacityId],
            comment: ["{0} is the capacity ID"],
        });
    };
    static createSqlDatabaseForWorkspace = (workspaceId) => {
        return vscode_1.l10n.t({
            message: "Creating SQL Database for workspace {0}",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };
    static listingRoleAssignmentsForWorkspace = (workspaceId) => {
        return vscode_1.l10n.t({
            message: "Listing role assignments for workspace '${workspaceId}'",
            args: [workspaceId],
            comment: ["{0} is the workspace ID"],
        });
    };
    static gettingFabricDatabase = (databaseId) => {
        return vscode_1.l10n.t({
            message: "Getting Fabric database '{0}'",
            args: [databaseId],
            comment: ["{0} is the database ID"],
        });
    };
    static fabricApiError = (resultCode, resultMessage) => {
        return vscode_1.l10n.t({
            message: "Fabric API error occurred ({0}): {1}",
            args: [resultCode, resultMessage],
            comment: ["{0} is the error code", "{1} is the error message"],
        });
    };
    static fabricLongRunningApiError = (resultCode, error) => {
        return vscode_1.l10n.t({
            message: "Fabric long-running API error with error code '{0}': {1}",
            args: [resultCode, error],
            comment: ["{0} is the error code", "{1} is the error message"],
        });
    };
    static fabricLongRunningApiMissingLocation = vscode_1.l10n.t(
        "Fabric long-running operation response did not include a location header.",
    );
    static fabricAccount = vscode_1.l10n.t("Fabric Account");
    static fabricAccountIsRequired = vscode_1.l10n.t("Fabric Account is required");
    static workspace = vscode_1.l10n.t("Workspace");
    static selectAWorkspace = vscode_1.l10n.t("Select a Workspace");
    static searchWorkspaces = vscode_1.l10n.t("Search Workspaces");
    static workspaceIsRequired = vscode_1.l10n.t("Workspace is required");
    static insufficientWorkspacePermissions = vscode_1.l10n.t("Insufficient Workspace Permissions");
    static fabricNotSupportedInCloud = (cloudName, settingName) => {
        return vscode_1.l10n.t({
            message:
                "Fabric is not supported in the current cloud ({0}).  Ensure setting '{1}' is configured correctly.",
            args: [cloudName, settingName],
            comment: ["{0} is the cloud name", "{1} is the setting name"],
        });
    };
}
exports.Fabric = Fabric;
class Accounts {
    static entraAccountNotAvailableThroughMsal(accountDisplayName, tenantId) {
        if (tenantId === undefined || tenantId === "") {
            return vscode_1.l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}' but that account is not signed into the MSSQL extension. Edit the connection or sign into MSSQL with that account to connect.",
                args: [accountDisplayName],
                comment: ["{0} is the account ID or label"],
            });
        } else {
            return vscode_1.l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}' on tenant '{1}', but that account is not signed into the MSSQL extension. Edit the connection or sign into MSSQL with that account to connect.",
                args: [accountDisplayName, tenantId],
                comment: ["{0} is the account ID or label", "{1} is the tenant ID"],
            });
        }
    }
    static accountNotAvailableThroughVsCode(accountDisplayName, tenantId) {
        if (tenantId === undefined || tenantId === "") {
            return vscode_1.l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}', but that account is not available through VS Code sign-in. Edit the connection or sign into VS Code with that account to connect.",
                args: [accountDisplayName],
                comment: ["{0} is the account ID or label"],
            });
        } else {
            return vscode_1.l10n.t({
                message:
                    "The selected profile authenticates using Entra ID '{0}' on tenant '{1}', but that account is not available through VS Code sign-in. Edit the connection or sign into VS Code with that account to connect.",
                args: [accountDisplayName, tenantId],
                comment: ["{0} is the account ID or label", "{1} is the tenant ID"],
            });
        }
    }
    static invalidEntraAccountsRemoved = (numRemoved) => {
        return vscode_1.l10n.t({
            message:
                "{0} invalid Entra accounts have been removed; you may need to run `MS SQL: Clear Microsoft Entra account token cache` and log in again.",
            args: [numRemoved],
            comment: ["{0} is the number of invalid accounts that have been removed"],
        });
    };
    static clearedEntraTokenCache = vscode_1.l10n.t("Entra token cache cleared successfully.");
}
exports.Accounts = Accounts;
class AzureSqlDatabase {
    static azureAccount = vscode_1.l10n.t("Azure Account");
    static azureAccountIsRequired = vscode_1.l10n.t("Azure Account is required");
    static subscription = vscode_1.l10n.t("Subscription");
    static selectASubscription = vscode_1.l10n.t("Select a subscription");
    static subscriptionIsRequired = vscode_1.l10n.t("Subscription is required");
    static resourceGroup = vscode_1.l10n.t("Resource Group");
    static selectAResourceGroup = vscode_1.l10n.t("Select a resource group");
    static resourceGroupIsRequired = vscode_1.l10n.t("Resource Group is required");
    static databaseName = vscode_1.l10n.t("Database Name");
    static enterDatabaseName = vscode_1.l10n.t("Enter database name");
    static databaseNameIsRequired = vscode_1.l10n.t("Database Name is required");
    static noAzureAccountsFound = vscode_1.l10n.t("No Azure accounts found");
    static noTenantsFound = vscode_1.l10n.t("No tenants found");
    static noSubscriptionsFound = vscode_1.l10n.t("No subscriptions found");
    static noResourceGroupsFound = vscode_1.l10n.t("No resource groups found");
    static server = vscode_1.l10n.t("Server");
    static selectAServer = vscode_1.l10n.t("Select a server");
    static serverIsRequired = vscode_1.l10n.t("SQL Server is required");
    static noServersFound = vscode_1.l10n.t("No servers found");
    static connectionFailed = vscode_1.l10n.t("Connection failed");
    static firewallRuleCreationFailed = (error) =>
        vscode_1.l10n.t({
            message: "Failed to create firewall rule: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static clientIpDetectionFailed = vscode_1.l10n.t(
        "Could not detect your client IP address. Please add a firewall rule manually in the Azure portal.",
    );
    static createNew = vscode_1.l10n.t("Create New");
    static enterResourceGroupName = vscode_1.l10n.t("Enter a name for the new resource group");
    static selectLocation = vscode_1.l10n.t("Select a location for the resource group");
    static resourceGroupNameIsRequired = vscode_1.l10n.t("Resource group name is required");
    static creating = vscode_1.l10n.t("Creating...");
    static enterServerName = vscode_1.l10n.t("Enter a name for the new server");
    static serverNameIsRequired = vscode_1.l10n.t("Server name is required");
    static creatingServer = vscode_1.l10n.t("Creating server...");
    static authenticationType = vscode_1.l10n.t("Authentication Type");
    static sqlLogin = vscode_1.l10n.t("SQL Authentication");
    static azureMFA = vscode_1.l10n.t("Microsoft Entra ID");
    static azureMFAAndUser = vscode_1.l10n.t("Both");
    static userName = vscode_1.l10n.t("Username");
    static enterUserName = vscode_1.l10n.t("Enter username");
    static password = vscode_1.l10n.t("Password");
    static enterPassword = vscode_1.l10n.t("Enter password");
    static savePassword = vscode_1.l10n.t("Save password");
    static userNameIsRequired = vscode_1.l10n.t("Username is required");
    static passwordIsRequired = vscode_1.l10n.t("Password is required");
    static dataSource = vscode_1.l10n.t("Data Source");
    static selectDataSource = vscode_1.l10n.t("Select a data source");
    static noDataSource = vscode_1.l10n.t("None (empty database)");
    static collation = vscode_1.l10n.t("Collation");
    static selectCollation = vscode_1.l10n.t("Select a collation");
    static loadingCollations = vscode_1.l10n.t("Loading collations...");
    static enableAlwaysEncrypted = vscode_1.l10n.t("Always Encrypted");
    static maintenanceWindow = vscode_1.l10n.t("Maintenance Window");
    static selectMaintenanceWindow = vscode_1.l10n.t("Select a maintenance window");
    static loadingMaintenanceConfigs = vscode_1.l10n.t("Loading maintenance windows...");
    static serverTooltipMFA = vscode_1.l10n.t(
        "This server only supports Microsoft Entra ID authentication.",
    );
    static databaseTooltipMFA = vscode_1.l10n.t(
        "Use Microsoft Entra ID authentication to provision and connect to this database.",
    );
    static serverTooltipMFAAndUser = vscode_1.l10n.t(
        "This server supports Microsoft Entra ID and SQL Authentication.",
    );
    static databaseTooltipMFAAndUser = vscode_1.l10n.t(
        "Connect using either Microsoft Entra ID or SQL Authentication.",
    );
    static userNameTooltip = vscode_1.l10n.t("[Read-only] Pre-filled from the server properties.");
    static serverTooltipSqlLogin = vscode_1.l10n.t("This server only supports SQL Authentication.");
    static databaseTooltipSqlLogin = vscode_1.l10n.t(
        "Use SQL Authentication with a valid username and password.",
    );
    static serverAuthTypeUnknown = vscode_1.l10n.t(
        "Unable to determine the server authentication type.",
    );
    static maxVcores = vscode_1.l10n.t("Max vCores");
    static selectMaxVcores = vscode_1.l10n.t("Select Max vCores");
}
exports.AzureSqlDatabase = AzureSqlDatabase;
class FabricProvisioning {
    static databaseName = vscode_1.l10n.t("Database Name");
    static enterDatabaseName = vscode_1.l10n.t("Enter Database Name");
    static databaseNameIsRequired = vscode_1.l10n.t("Database Name is required");
    static databaseDescription = vscode_1.l10n.t("Database Description");
    static enterDatabaseDescription = vscode_1.l10n.t("Enter Database Description");
    static workspacePermissionsError = vscode_1.l10n.t(
        "Please select a workspace where you have sufficient permissions (Contributor or higher)",
    );
    static databaseNameError = vscode_1.l10n.t(
        "This database name is already in use. Please choose a different name.",
    );
}
exports.FabricProvisioning = FabricProvisioning;
class QueryResult {
    static nonNumericSelectionSummary = (count, distinctCount, nullCount) =>
        vscode_1.l10n.t({
            message: "Count: {0}  Distinct Count: {1}  Null Count: {2}",
            args: [count, distinctCount, nullCount],
            comment: ["{0} is the count, {1} is the distinct count, and {2} is the null count"],
        });
    static numericSelectionSummary = (average, count, sum) =>
        vscode_1.l10n.t({
            message: "Average: {0}  Count: {1}  Sum: {2}",
            args: [average, count, sum],
            comment: ["{0} is the average, {1} is the count, {2} is the sum"],
        });
    static numericSelectionSummaryTooltip = (
        average,
        count,
        distinctCount,
        max,
        min,
        nullCount,
        sum,
    ) => {
        return [
            vscode_1.l10n.t({
                message: "Average: {0}",
                args: [average],
                comment: ["{0} is the average"],
            }),
            vscode_1.l10n.t({
                message: "Count: {0}",
                args: [count],
                comment: ["{0} is the count"],
            }),
            vscode_1.l10n.t({
                message: "Distinct Count: {0}",
                args: [distinctCount],
                comment: ["{0} is the distinct count"],
            }),
            vscode_1.l10n.t({
                message: "Max: {0}",
                args: [max],
                comment: ["{0} is the max"],
            }),
            vscode_1.l10n.t({
                message: "Min: {0}",
                args: [min],
                comment: ["{0} is the min"],
            }),
            vscode_1.l10n.t({
                message: "Null Count: {0}",
                args: [nullCount],
                comment: ["{0} is the null count"],
            }),
            vscode_1.l10n.t({
                message: "Sum: {0}",
                args: [sum],
                comment: ["{0} is the sum"],
            }),
        ].join(os.EOL);
    };
    static nonNumericSelectionSummaryTooltip = (count, distinctCount, nullCount) => {
        return [
            vscode_1.l10n.t({
                message: "Count: {0}",
                args: [count],
                comment: ["{0} is the count"],
            }),
            vscode_1.l10n.t({
                message: "Distinct Count: {0}",
                args: [distinctCount],
                comment: ["{0} is the distinct count"],
            }),
            vscode_1.l10n.t({
                message: "Null Count: {0}",
                args: [nullCount],
                comment: ["{0} is the null count"],
            }),
        ].join(os.EOL);
    };
    static copyError = (error) =>
        vscode_1.l10n.t({
            message: "An error occurred while copying results: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static summaryFetchConfirmation = (numRows) =>
        vscode_1.l10n.t({
            message: "{0} rows selected, click to load summary",
            args: [numRows],
            comment: ["{0} is the number of rows to fetch summary statistics for"],
        });
    static clickToFetchSummary = vscode_1.l10n.t("Click to load summary");
    static summaryLoadingProgress = (totalRows) => {
        return vscode_1.l10n.t({
            message: `Loading summary for {0} rows (Click to cancel)`,
            args: [totalRows],
            comment: ["{0} is the total number of rows"],
        });
    };
    static clickToCancelLoadingSummary = vscode_1.l10n.t("Click to cancel loading summary");
    static summaryLoadingCanceled = vscode_1.l10n.t("Summary loading canceled");
    static summaryLoadingCanceledTooltip = vscode_1.l10n.t("Summary loading was canceled by user");
    static errorLoadingSummary = vscode_1.l10n.t("Error loading summary");
    static errorLoadingSummaryTooltip = (error) =>
        vscode_1.l10n.t({
            message: "Error loading summary: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static getRowsError = (error) =>
        vscode_1.l10n.t({
            message: "An error occurred while retrieving rows: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static queryResultPanelFailedToLoad = vscode_1.l10n.t(
        "The query results panel failed to load. Please try running the query again.",
    );
}
exports.QueryResult = QueryResult;
class LocalContainers {
    static stoppedContainerSucessfully = (name) =>
        vscode_1.l10n.t({
            message: "{0} stopped successfully.",
            args: [name],
            comment: ["{0} stopped successfully."],
        });
    static failStopContainer = (name) =>
        vscode_1.l10n.t({
            message: "Failed to stop {0}.",
            args: [name],
            comment: ["Failed to stop {0}."],
        });
    static startedContainerSucessfully = (name) =>
        vscode_1.l10n.t({
            message: "{0} started successfully.",
            args: [name],
            comment: ["{0} started successfully."],
        });
    static startingContainer = (name) =>
        vscode_1.l10n.t({
            message: "Starting {0}...",
            args: [name],
            comment: ["{0} is the container name"],
        });
    static failStartContainer = (name) =>
        vscode_1.l10n.t({
            message: "Failed to start {0}.",
            args: [name],
            comment: ["Failed to start {0}."],
        });
    static deletedContainerSucessfully = (name) =>
        vscode_1.l10n.t({
            message: "{0} deleted successfully.",
            args: [name],
            comment: ["{0} deleted successfully."],
        });
    static failDeleteContainer = (name) =>
        vscode_1.l10n.t({
            message: "Failed to delete {0}.",
            args: [name],
            comment: ["Failed to delete {0}."],
        });
    static selectImage = vscode_1.l10n.t("Select image");
    static selectImageTooltip = vscode_1.l10n.t("Select the SQL Server Container Image");
    static sqlServerVersionImage = (version) =>
        vscode_1.l10n.t({
            message: "SQL Server {0} - latest",
            args: [version],
            comment: ["{0} is the SQL Server version"],
        });
    static sqlServerPasswordTooltip = vscode_1.l10n.t("SQL Server Container SA Password");
    static pleaseChooseUniqueProfileName = vscode_1.l10n.t(
        "Please choose a unique name for the profile",
    );
    static containerName = vscode_1.l10n.t("Container Name");
    static containerNameTooltip = vscode_1.l10n.t(
        "Choose a name for the SQL Server Docker Container",
    );
    static pleaseChooseUniqueContainerName = vscode_1.l10n.t(
        "Please choose a unique name for the container",
    );
    static port = vscode_1.l10n.t("Port");
    static portTooltip = vscode_1.l10n.t("Choose a port to host the SQL Server Docker Container");
    static pleaseChooseUnusedPort = vscode_1.l10n.t(
        "Please make sure the port is a number, and choose a port that is not in use",
    );
    static hostname = vscode_1.l10n.t("Hostname");
    static hostnameTooltip = vscode_1.l10n.t("Choose a hostname for the container");
    static termsAndConditions = vscode_1.l10n.t("Terms & Conditions");
    static acceptSqlServerEulaTooltip = vscode_1.l10n.t(
        "Accept the SQL Server EULA to deploy a SQL Server Docker container",
    );
    static acceptSqlServerEula = vscode_1.l10n.t("Please Accept the SQL Server EULA");
    static dockerInstallHeader = vscode_1.l10n.t("Checking if Docker is installed");
    static dockerInstallBody = vscode_1.l10n.t("Checking if Docker is installed on your machine");
    static dockerInstallError = vscode_1.l10n.t(
        "Docker is not installed or not in PATH. Please install Docker Desktop and try again.",
    );
    static startDockerHeader = vscode_1.l10n.t("Checking if Docker is started");
    static startDockerBody = vscode_1.l10n.t(
        "Checking if Docker is running on your machine. If not, we'll start it for you.",
    );
    static dockerError = vscode_1.l10n.t(
        "Error running Docker commands. Please make sure Docker is running.",
    );
    static startDockerEngineHeader = vscode_1.l10n.t("Checking Docker Engine Configuration");
    static startDockerEngineBody = vscode_1.l10n.t(
        "Checking if the Docker Engine is configured correctly on your machine.",
    );
    static pullImageHeader = vscode_1.l10n.t("Pulling SQL Server Image");
    static pullImageBody = vscode_1.l10n.t(
        "Pulling the SQL Server container image. This might take a few minutes depending on your internet connection.",
    );
    static creatingContainerHeader = vscode_1.l10n.t("Creating Container");
    static creatingContainerBody = vscode_1.l10n.t(
        "Creating and starting your SQL Server container",
    );
    static settingUpContainerHeader = vscode_1.l10n.t("Setting up container");
    static settingUpContainerBody = vscode_1.l10n.t("Readying container for connections.");
    static connectingToContainerHeader = vscode_1.l10n.t("Connecting to Container");
    static connectingToContainerBody = vscode_1.l10n.t(
        "Connecting to your SQL Server Docker container",
    );
    static passwordLengthError = vscode_1.l10n.t(
        "Please make your password 8-128 characters long.",
    );
    static passwordComplexityError = vscode_1.l10n.t(
        "Your password must contain characters from at least three of the following categories: uppercase letters, lowercase letters, numbers (0-9), and special characters (!, $, #, %, etc.).",
    );
    static pullSqlServerContainerImageError = vscode_1.l10n.t(
        "Failed to pull SQL Server image. Please check your network connection and try again.",
    );
    static unsupportedDockerPlatformError = (platform) =>
        vscode_1.l10n.t({
            message: "Unsupported platform for Docker: {0}",
            args: [platform],
            comment: ["{0} is the platform name of the machine"],
        });
    static unsupportedDockerArchitectureError = (architecture) =>
        vscode_1.l10n.t({
            message: "Unsupported architecture for Docker: {0}",
            args: [architecture],
            comment: ["{0} is the architecture name of the machine"],
        });
    static rosettaError = vscode_1.l10n.t(
        'Rosetta is required to run SQL Server container images on Apple Silicon. Enable "Use Rosetta for x86_64/amd64 emulation on Apple Silicon" in Docker Desktop > Settings > General.',
    );
    static windowsContainersError = vscode_1.l10n.t(
        "SQL Server does not support Windows containers. Please switch to Linux containers in Docker Desktop settings.",
    );
    static linuxDockerPermissionsError = vscode_1.l10n.t(
        "Docker requires root permissions to run. Please run Docker with sudo or add your user to the docker group using sudo usermod -aG docker $USER. Then, reboot your machine and retry.",
    );
    static dockerSocketPermissionError = vscode_1.l10n.t(
        "Cannot access the Docker socket. Your user may not be in the 'docker' group, or VS Code was started before group membership took effect. Run 'sudo usermod -aG docker $USER' and then log out and back in (or reboot) before relaunching VS Code.",
    );
    static dockerFailedToStartWithinTimeout = vscode_1.l10n.t(
        "Docker failed to start within the timeout period. Please manually start Docker and try again.",
    );
    static containerFailedToStartWithinTimeout = vscode_1.l10n.t(
        "Container failed to start within the timeout period. Please wait a few minutes and try again.",
    );
    static dockerDesktopPathError = vscode_1.l10n.t(
        "We can't find where Docker Desktop is located on your machine. Please manually start Docker Desktop and try again.",
    );
    static installDocker = vscode_1.l10n.t("Install Docker");
    static msgCreateLocalSqlContainer = vscode_1.l10n.t("Create Local SQL Container");
    static startingDockerLoadingLabel = vscode_1.l10n.t("Starting Docker...");
    static startingContainerLoadingLabel = vscode_1.l10n.t("Starting Container...");
    static readyingContainerLoadingLabel = vscode_1.l10n.t("Readying container for connections...");
    static stoppingContainerLoadingLabel = vscode_1.l10n.t("Stopping Container...");
    static deletingContainerLoadingLabel = vscode_1.l10n.t("Deleting Container...");
    static deleteContainerConfirmation = (containerName) => {
        return vscode_1.l10n.t({
            message:
                "Are you sure you want to delete the container {0}? This will remove both the container and its connection from VS Code.",
            args: [containerName],
            comment: ["{0} is the container name"],
        });
    };
    static configureLinuxContainers = vscode_1.l10n.t("Configure Linux containers");
    static configureRosetta = vscode_1.l10n.t("Configure Rosetta in Docker Desktop");
    static switchToLinuxContainersConfirmation = vscode_1.l10n.t(
        "Your Docker Engine currently runs Windows containers. SQL Server only supports Linux containers. Would you like to switch to Linux containers?",
    );
    static switchToLinuxContainersCanceled = vscode_1.l10n.t(
        "Switching to Linux containers was canceled. SQL Server only supports Linux containers.",
    );
    static startSqlServerContainerError = vscode_1.l10n.t(
        "Failed to start SQL Server container. Please check the error message for more details, and then try again.",
    );
    static containerDoesNotExistError = vscode_1.l10n.t(
        "Container does not exist. Would you like to remove the connection?",
    );
    static passwordPlaceholder = vscode_1.l10n.t("Enter password");
    static containerNamePlaceholder = vscode_1.l10n.t("Enter container name");
    static portPlaceholder = vscode_1.l10n.t("Enter port");
    static hostnamePlaceholder = vscode_1.l10n.t("Enter hostname");
    // DAB (Data API builder) deployment strings
    static dabContainerNameInvalidOrInUse = vscode_1.l10n.t(
        "Container name is invalid or already in use",
    );
    static dabPortAlreadyInUse = (port) =>
        vscode_1.l10n.t({
            message: "Port {0} is already in use",
            args: [port],
            comment: ["{0} is the port number"],
        });
    static dabStartContainerMissingParams = vscode_1.l10n.t(
        "Container name, port, and config content are required to start the container.",
    );
    static dabFailedToStartContainer = vscode_1.l10n.t("Failed to start DAB container.");
    static dabCheckContainerMissingParams = vscode_1.l10n.t(
        "Container name and port are required to check container readiness.",
    );
    static dabUnknownDeploymentStep = (step) =>
        vscode_1.l10n.t({
            message: "Unknown deployment step: {0}",
            args: [step],
            comment: ["{0} is the deployment step number"],
        });
    static dabPullImageError = vscode_1.l10n.t(
        "Failed to pull DAB container image. Please check your network connection.",
    );
    static dabStartContainerError = vscode_1.l10n.t(
        "Failed to start DAB container. Please check the Docker logs for details.",
    );
    static dabContainerReadyTimeout = vscode_1.l10n.t(
        "DAB container failed to become ready within the timeout period.",
    );
    static dabStopContainerError = vscode_1.l10n.t("Failed to stop and remove DAB container.");
}
exports.LocalContainers = LocalContainers;
class UserSurvey {
    static overallHowSatisfiedAreYouWithMSSQLExtension = vscode_1.l10n.t(
        "Overall, how satisfied are you with the MSSQL extension?",
    );
    static howlikelyAreYouToRecommendMSSQLExtension = vscode_1.l10n.t(
        "How likely it is that you would recommend the MSSQL extension to a friend or colleague?",
    );
    static whatCanWeDoToImprove = vscode_1.l10n.t("What can we do to improve?");
    static takeSurvey = vscode_1.l10n.t("Take Survey");
    static doYouMindTakingAQuickFeedbackSurvey = vscode_1.l10n.t(
        "Do you mind taking a quick feedback survey about the MSSQL Extension for VS Code?",
    );
    static mssqlFeedback = vscode_1.l10n.t("MSSQL Feedback");
    static privacyDisclaimer = vscode_1.l10n.t(
        "Microsoft reviews your feedback to improve our products, so don't share any personal data or confidential/proprietary content.",
    );
    static overallHowStatisfiedAreYouWithFeature = (featureName) =>
        vscode_1.l10n.t({
            message: "Overall, how satisfied are you with {0}?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });
    static howLikelyAreYouToRecommendFeature = (featureName) =>
        vscode_1.l10n.t({
            message: "How likely it is that you would recommend {0} to a friend or colleague?",
            args: [featureName],
            comment: ["{0} is the feature name"],
        });
    static fileAnIssuePrompt = vscode_1.l10n.t(
        "Encountering a problem?  Share the details with us by opening a GitHub issue so we can improve!",
    );
    static submitIssue = vscode_1.l10n.t("Submit an issue");
    static mssqlMarketplaceReviewPrompt = vscode_1.l10n.t(
        "We're glad you're enjoying MSSQL for VS Code!  Please consider leaving a quick review on the VS Code Marketplace.",
    );
    static writeReview = vscode_1.l10n.t("Write a review");
}
exports.UserSurvey = UserSurvey;
class Webview {
    static webviewRestorePrompt = (webviewName) =>
        vscode_1.l10n.t({
            message: "{0} has been closed. Would you like to restore it?",
            args: [webviewName],
            comment: ["{0} is the webview name"],
        });
    static Restore = vscode_1.l10n.t("Restore");
    static webviewNotReadyTimeout = (webviewName, timeoutMs) =>
        vscode_1.l10n.t({
            message: "Webview '{0}' did not become ready within {1}ms",
            args: [webviewName, timeoutMs],
            comment: ["{0} is the webview name", "{1} is the timeout in milliseconds"],
        });
    static webviewDisposedBeforeReady = vscode_1.l10n.t(
        "Webview was disposed before it became ready",
    );
}
exports.Webview = Webview;
class TableDesigner {
    static General = vscode_1.l10n.t("General");
    static Columns = vscode_1.l10n.t("Columns");
    static AdvancedOptions = vscode_1.l10n.t("Advanced Options");
}
exports.TableDesigner = TableDesigner;
class PublishProject {
    static Title = vscode_1.l10n.t("Publish Project");
    static PublishProfileLabel = vscode_1.l10n.t("Publish Profile");
    static PublishProfilePlaceholder = vscode_1.l10n.t("Load profile...");
    static SelectPublishProfile = vscode_1.l10n.t("Select Profile");
    static SaveAs = vscode_1.l10n.t("Save As");
    static PublishSettingsFile = vscode_1.l10n.t("Publish Settings File");
    static ServerLabel = vscode_1.l10n.t("Server");
    static DatabaseLabel = vscode_1.l10n.t("Database");
    static DatabaseRequiredMessage = vscode_1.l10n.t("Database name is required");
    static SqlCmdVariablesLabel = vscode_1.l10n.t("SQLCMD Variables");
    static PublishTargetLabel = vscode_1.l10n.t("Publish Target");
    static PublishTargetExisting = vscode_1.l10n.t("Existing SQL Server");
    static PublishTargetContainer = vscode_1.l10n.t("New Local Docker SQL Server");
    static PublishTargetNewAzureServer = vscode_1.l10n.t("New Azure SQL logical server (Preview)");
    static GenerateScript = vscode_1.l10n.t("Generate Script");
    static Publish = vscode_1.l10n.t("Publish");
    static BuildProjectTaskLabel(projectName) {
        return vscode_1.l10n.t("Build {0}", projectName);
    }
    static BuildingProjectProgress(projectName) {
        return vscode_1.l10n.t("Building {0}...", projectName);
    }
    static BuildFailedWithExitCode(exitCode) {
        return vscode_1.l10n.t("Build failed with exit code {0}", exitCode);
    }
    static SqlServerPortNumber = vscode_1.l10n.t("SQL Server port number");
    static SqlServerAdminPassword = vscode_1.l10n.t("SQL Server admin password");
    static SqlServerAdminPasswordConfirm = vscode_1.l10n.t("Confirm SQL Server admin password");
    static SqlServerImageTag = vscode_1.l10n.t("Image tag");
    static SqlServerLicenseAgreement = vscode_1.l10n.t("Microsoft SQL Server License Agreement");
    static ServerConnectionPlaceholder = vscode_1.l10n.t("Select Connection");
    static CheckingDockerPrerequisites = vscode_1.l10n.t("Checking Docker prerequisites...");
    static CreatingSqlServerContainer = vscode_1.l10n.t("Creating SQL Server container...");
    // Validation messages
    static PortAlreadyInUse = (port) =>
        vscode_1.l10n.t({
            message: "Port {0} is already in use. Please choose a different port.",
            args: [port],
            comment: ["{0} is the port number"],
        });
    static InvalidSQLPasswordMessage(name) {
        return vscode_1.l10n.t(
            "Invalid SQL Server password for {0}. Password must be 8–128 characters long and meet the complexity requirements.  For more information see https://docs.microsoft.com/sql/relational-databases/security/password-policy",
            name,
        );
    }
    static PasswordNotMatchMessage = (name) => {
        return vscode_1.l10n.t("{0} password doesn't match the confirmation password", name);
    };
    static RequiredFieldMessage = vscode_1.l10n.t("Required");
    static LicenseAcceptanceMessage = vscode_1.l10n.t("You must accept the license");
    static PublishProfileLoadFailed = vscode_1.l10n.t("Failed to load publish profile");
    static PublishProfileSavedSuccessfully = (path) => {
        return vscode_1.l10n.t("Publish profile saved to: {0}", path);
    };
    static PublishProfileSaveFailed = vscode_1.l10n.t("Failed to save publish profile");
    static DacFxServiceNotAvailable = vscode_1.l10n.t(
        "DacFx service is not available. Publish and generate script operations cannot be performed.",
    );
    static DacFxServiceNotAvailableProfileLoaded = vscode_1.l10n.t(
        "DacFx service is not available. Profile loaded without deployment options. Publish and generate script operations cannot be performed.",
    );
    static FailedToListDatabases = vscode_1.l10n.t("Failed to list databases");
    static FailedToConnectToServer = vscode_1.l10n.t("Failed to connect to server");
    static ConnectionProfileNotFound = vscode_1.l10n.t(
        "Connection profile not found. Please create a new connection using the Connection Dialog.",
    );
    static FailedToFetchContainerTags = (errorMessage) => {
        return vscode_1.l10n.t("Failed to fetch Docker container tags: {0}", errorMessage);
    };
    static ProfileLoadedConnectionFailed = (serverName) =>
        vscode_1.l10n.t({
            message:
                "Profile loaded, but the connection could not be automatically established. Please create a connection to {0} then try again.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    static FailedToGenerateSqlPackageCommand(errorMessage) {
        return vscode_1.l10n.t("Failed to generate SqlPackage command: {0}", errorMessage);
    }
    static FailedToGetConnectionString(errorMessage) {
        return vscode_1.l10n.t("Failed to get connection string: {0}", errorMessage);
    }
    static NoActiveConnection = vscode_1.l10n.t("No active connection");
    static DacpacPathNotFound = vscode_1.l10n.t(
        "DACPAC path not found. Please build the project first.",
    );
}
exports.PublishProject = PublishProject;
class CodeAnalysis {
    static Title = vscode_1.l10n.t("Code Analysis");
    static failedToLoadRules = vscode_1.l10n.t("Failed to load code analysis rules");
    static failedToLoadOverrides = vscode_1.l10n.t(
        "Failed to read saved rule overrides from project",
    );
    static failedToSaveRules = vscode_1.l10n.t("Failed to save code analysis rules");
    static rulesSaved = vscode_1.l10n.t("Code analysis rules saved successfully");
}
exports.CodeAnalysis = CodeAnalysis;
class SchemaCompare {
    static Title = vscode_1.l10n.t("Schema Compare");
    static Open = vscode_1.l10n.t("Open");
    static Save = vscode_1.l10n.t("Save");
    static defaultUserName = vscode_1.l10n.t("default");
    static Yes = vscode_1.l10n.t("Yes");
    static No = vscode_1.l10n.t("No");
    static optionsChangedMessage = vscode_1.l10n.t(
        "Options have changed. Recompare to see the comparison?",
    );
    static generateScriptErrorMessage = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to generate script: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the generate script operation"],
        });
    static areYouSureYouWantToUpdateTheTarget = vscode_1.l10n.t(
        "Are you sure you want to update the target?",
    );
    static schemaCompareApplyFailed = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to apply changes: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the publish changes operation"],
        });
    static openScmpErrorMessage = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to open scmp file: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the open scmp operation"],
        });
    static saveScmpErrorMessage = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to save scmp file: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the save scmp operation"],
        });
    static cancelErrorMessage = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Cancel schema compare failed: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the cancel operation"],
        });
    static compareErrorMessage = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Schema Compare failed: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the compare operation"],
        });
    static cannotExcludeEntryWithBlockingDependency = (diffEntryName, firstDependentName) =>
        vscode_1.l10n.t({
            message: "Cannot exclude {0}. Included dependents exist, such as {1}",
            args: [diffEntryName, firstDependentName],
            comment: [
                "{0} is the name of the entry",
                "{1} is the name of the blocking dependency preventing exclusion.",
            ],
        });
    static cannotIncludeEntryWithBlockingDependency = (diffEntryName, firstDependentName) =>
        vscode_1.l10n.t({
            message: "Cannot include {0}. Excluded dependents exist, such as {1}",
            args: [diffEntryName, firstDependentName],
            comment: [
                "{0} is the name of the entry",
                "{1} is the name of the blocking dependency preventing inclusion.",
            ],
        });
    static cannotExcludeEntry = (diffEntryName) =>
        vscode_1.l10n.t({
            message: "Cannot exclude {0}. Included dependents exist",
            args: [diffEntryName],
            comment: ["{0} is the name of the entry"],
        });
    static cannotIncludeEntry = (diffEntryName) =>
        vscode_1.l10n.t({
            message: "Cannot include {0}. Excluded dependents exist",
            args: [diffEntryName],
            comment: ["{0} is the name of the entry"],
        });
    static connectionFailed = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Connection failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message from the connection attempt"],
        });
}
exports.SchemaCompare = SchemaCompare;
class SchemaDesigner {
    static LoadingSchemaDesginerModel = vscode_1.l10n.t("Loading Schema Designer Model...");
    static PanelTitle = vscode_1.l10n.t("Visualize and Design Schema");
    static ReadOnlyPanelTitle = vscode_1.l10n.t("Table Diagram");
    static SchemaReady = vscode_1.l10n.t(
        "Schema Designer Model is ready. Changes can now be published.",
    );
    static SaveAs = vscode_1.l10n.t("Save As");
    static Save = vscode_1.l10n.t("Save");
    static SchemaDesigner = vscode_1.l10n.t("Schema Designer");
    static OpeningPublishScript = vscode_1.l10n.t(
        "Opening Publish Script. This may take a while...",
    );
    static GeneratingReport = vscode_1.l10n.t("Generating Report. This may take a while...");
    static PublishScriptFailed = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to generate publish script: '{0}'",
            args: [errorMessage ? errorMessage : "Unknown"],
            comment: ["{0} is the error message returned from the generate script operation"],
        });
    static mcpServerAddedToWorkspace = (filePath) =>
        vscode_1.l10n.t({
            message: "MCP server added to {0}",
            args: [filePath],
            comment: ["{0} is the file path where the MCP server was added"],
        });
    static mcpServerAlreadyExists = (filePath) =>
        vscode_1.l10n.t({
            message: "MCP server is already configured in {0}",
            args: [filePath],
            comment: ["{0} is the file path where the MCP server configuration exists"],
        });
    static noWorkspaceOpenForMcp = vscode_1.l10n.t(
        "No workspace folder is open. Open a folder to add the MCP server configuration.",
    );
    static noWorkspaceOpenForGeneratedFile = vscode_1.l10n.t(
        "No workspace folder is open. Open a folder to add the generated file.",
    );
    static generatedFileAddedToWorkspace = (filePath) =>
        vscode_1.l10n.t({
            message: "Generated file added to {0}",
            args: [filePath],
            comment: ["{0} is the generated file path"],
        });
    static configCopiedToClipboard = vscode_1.l10n.t("Config copied to clipboard");
    static urlCopiedToClipboard = vscode_1.l10n.t("URL copied to clipboard");
    static logsCopiedToClipboard = vscode_1.l10n.t("Logs copied to clipboard");
    static dabLogsEditorTitle = vscode_1.l10n.t("DAB container logs");
    static failedToOpenUrl = vscode_1.l10n.t(
        "Failed to open URL. The built-in Simple Browser may be disabled.",
    );
    static dabDeploymentNotSupported = vscode_1.l10n.t(
        "Local container deployment is currently only supported with SQL Authentication connections.",
    );
}
exports.SchemaDesigner = SchemaDesigner;
class StatusBar {
    static disconnectedLabel = vscode_1.l10n.t("Connect to MSSQL");
    static notConnectedTooltip = vscode_1.l10n.t("Click to connect to a database");
    static connectingLabel = vscode_1.l10n.t("Connecting");
    static connectErrorLabel = vscode_1.l10n.t("Connection error"); // {0} is the server name
}
exports.StatusBar = StatusBar;
class Connection {
    static connectingToProfile = (profileName) => {
        return vscode_1.l10n.t({
            message: "Connecting to {0}...",
            args: [profileName],
            comment: ["{0} is the connection display name"],
        });
    };
    static missingConnectionIdsError = (connectionDisplayNames) => {
        return vscode_1.l10n.t({
            message:
                "The following workspace or workspace folder connections are missing the 'id' property and are being ignored.  Please manually add the 'id' property to the connection in order to use it. \n\n {0}",
            args: [connectionDisplayNames.join("\n")],
            comment: [
                "{0} is the list of display names for the connections that have been ignored",
            ],
        });
    };
    static missingConnectionInformation = (connectionId) => {
        return vscode_1.l10n.t({
            message:
                "The connection with ID '{0}' does not have the 'server' property set and is being ignored.  Please set the 'server' property on this connection in order to use it.",
            args: [connectionId],
            comment: ["{0} is the connection ID for the connection that has been ignored"],
        });
    };
    static orphanedConnectionGroupsWarning = (groupNames) => {
        return vscode_1.l10n.t({
            message:
                "One or more connection groups reference parent groups that do not exist and have been ignored: {0}. Update your settings file to fix these entries.",
            args: [groupNames],
            comment: ["{0} is the comma separated list of connection group names"],
        });
    };
    static orphanedConnectionsWarning = (connectionDisplayNames) => {
        return vscode_1.l10n.t({
            message:
                "One or more connections reference groups that do not exist and have been ignored: {0}. Update your connection settings to fix these entries.",
            args: [connectionDisplayNames.join(", ")],
            comment: ["{0} is the comma separated list of connection display names"],
        });
    };
    static multipleRootGroupsFoundError = (rootId) => {
        return vscode_1.l10n.t({
            message:
                "Multiple connection groups with ID '{0}' found.  Delete or rename all of them, except one in User/Global settings.json, then restart the extension.",
            args: [rootId],
            comment: ["{0} is the root id"],
        });
    };
    static defaultConnectionIdNotFoundWarning = (connectionId) => {
        return vscode_1.l10n.t({
            message:
                "The connection ID '{0}' set in 'mssql.defaultConnectionId' does not match any known connection profile. New editors will fall back to transferring the active connection.",
            args: [connectionId],
            comment: ["{0} is the connection ID that was not found"],
        });
    };
    static defaultConnectionIdNotSetWarning = vscode_1.l10n.t(
        "'mssql.newEditorConnectionBehavior' is set to 'defaultConnection', but 'mssql.defaultConnectionId' is not configured. New editors will fall back to transferring the active connection.",
    );
    static defaultConnectionSelectConnection = vscode_1.l10n.t("Select Connection");
    static defaultConnectionChangeSetting = vscode_1.l10n.t("Change Setting");
    static defaultConnectionSelectConnectionPlaceholder = vscode_1.l10n.t(
        "Select a connection to use as the default",
    );
    static defaultConnectionChangeSettingPlaceholder = vscode_1.l10n.t(
        "Choose the behavior for new editors",
    );
    static defaultConnectionBehaviorTransferActive = vscode_1.l10n.t(
        "Transfer active connection (Default)",
    );
    static defaultConnectionBehaviorNone = vscode_1.l10n.t("Do not connect");
    static errorMigratingLegacyConnection = (connectionId, errorMessage) => {
        return vscode_1.l10n.t({
            message:
                "Error migrating connection ID {0} to new format.  Please recreate this connection to use it.\nError:\n{1}",
            args: [connectionId, errorMessage],
            comment: ["{0} is the connection id", "{1} is the error message"],
        });
    };
    static noAccountSelected = vscode_1.l10n.t("No account selected");
    static currentAccount = (accountDisplayName) => {
        return vscode_1.l10n.t({
            message: "{0} (Current Account)",
            args: [accountDisplayName],
            comment: ["{0} is the account display name"],
        });
    };
    static signInToAzure = vscode_1.l10n.t("Sign in to a new account");
    static SelectAccountForKeyVault = vscode_1.l10n.t(
        "Select Azure account with Key Vault access for column decryption",
    );
    static NoTenantSelected = vscode_1.l10n.t("No tenant selected");
    static SelectTenant = vscode_1.l10n.t("Select a tenant");
    static ChangePassword = vscode_1.l10n.t("Change Password");
    static trustServerCertificateMustBeEnabledMessage = vscode_1.l10n.t(
        "Encryption was enabled on this connection; review your SSL and certificate configuration for the target SQL Server, or set 'Trust server certificate' to 'true'. Note: A self-signed certificate offers only limited protection and is not a recommended practice for production environments.",
    );
    static trustServerCertificateMustBeEnabledPrompt = vscode_1.l10n.t(
        "Do you want to enable 'Trust server certificate' on this connection and retry?",
    );
    static securityTokenRequestFailed = (errorMessage, resource) => {
        return vscode_1.l10n.t({
            message: "Failed to obtain token for resource '{1}'.  Error: {0}",
            args: [errorMessage, resource],
            comment: ["{0} is the error message", "{1} is the resource"],
        });
    };
    static failedToAcquireToken = (accountId, tenantId) => {
        return vscode_1.l10n.t({
            message: "Failed to acquire token for account '{0}' and tenant '{1}'",
            args: [accountId, tenantId],
            comment: ["{0} is the account ID", "{1} is the tenant ID"],
        });
    };
}
exports.Connection = Connection;
class MssqlChatAgent {
    static noModelFound = vscode_1.l10n.t("No model found.");
    static noToolsToProcess = vscode_1.l10n.t("No tools to process.");
    static notConnected = vscode_1.l10n.t("You are not connected to any database.");
    static connectedTo = vscode_1.l10n.t("Connected to:");
    static server = (serverName) => {
        return vscode_1.l10n.t({
            message: "Server - {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    static database = (databaseName) => {
        return vscode_1.l10n.t({
            message: "Database - {0}",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    };
    static usingModel = (modelName, canSendRequest) => {
        return vscode_1.l10n.t({
            message: "Using {0} ({1})...",
            args: [modelName, canSendRequest],
            comment: ["{0} is the model name", "{1} is whether the model can send requests"],
        });
    };
    static toolLookupFor = (partName, partInput) => {
        return vscode_1.l10n.t({
            message: "Tool lookup for: {0} - {1}.",
            args: [partName, partInput],
            comment: ["{0} is the part name", "{1} is the part input"],
        });
    };
    static gotInvalidToolUseParameters = (partInput, errorMessage) => {
        return vscode_1.l10n.t({
            message: 'Got invalid tool use parameters: "{0}". ({1})',
            args: [partInput, errorMessage],
            comment: ["{0} is the part input", "{1} is the error message"],
        });
    };
    static callingTool = (toolFunctionName, sqlToolParameters) => {
        return vscode_1.l10n.t({
            message: "Calling tool: {0} with {1}.",
            args: [toolFunctionName, sqlToolParameters],
            comment: ["{0} is the tool function name", "{1} is the SQL tool parameters"],
        });
    };
    static modelNotFoundError = vscode_1.l10n.t(
        "The requested model could not be found. Please check model availability or try a different model.",
    );
    static noPermissionError = vscode_1.l10n.t(
        "Access denied. Please ensure you have the necessary permissions to use this tool or model.",
    );
    static quoteLimitExceededError = vscode_1.l10n.t(
        "Usage limits exceeded. Try again later, or consider optimizing your requests.",
    );
    static offTopicError = vscode_1.l10n.t(
        "I'm sorry, I can only assist with SQL-related questions.",
    );
    static unexpectedError = vscode_1.l10n.t(
        "An unexpected error occurred with the language model. Please try again.",
    );
    static usingModelToProcessRequest = (modelName) => {
        return vscode_1.l10n.t({
            message: "Using {0} to process your request...",
            args: [modelName],
            comment: ["{0} is the model name that will be processing the request"],
        });
    };
    static languageModelDidNotReturnAnyOutput = vscode_1.l10n.t(
        "The language model did not return any output.",
    );
    static errorOccurredWhileProcessingRequest = vscode_1.l10n.t(
        "An error occurred while processing your request.",
    );
    static errorOccurredWith = (errorMessage) => {
        return vscode_1.l10n.t({
            message: "An error occurred: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    static unknownErrorOccurred = vscode_1.l10n.t("An unknown error occurred. Please try again.");
    static messageCouldNotBeProcessed = vscode_1.l10n.t(
        "This message couldn't be processed. If this issue persists, please check the logs and open an issue on GitHub.",
    );
    static connect = vscode_1.l10n.t("Connect");
    static openSqlEditorAndConnect = vscode_1.l10n.t("Open SQL editor and connect");
    static connectionRequiredMessage = (buttonText) => {
        return vscode_1.l10n.t({
            message:
                'An active connection is required for GitHub Copilot to understand your database schema and proceed.\nSelect "{0}" to establish a connection.',
            args: [buttonText],
            comment: ["{0} is the button text (e.g., 'Connect' or 'Open SQL editor and connect')"],
        });
    };
    // Follow-up questions
    static followUpConnectToDatabase = vscode_1.l10n.t("Connect to a database");
    static followUpShowRandomTableDefinition = vscode_1.l10n.t("Show a random table definition");
    static followUpCountTables = vscode_1.l10n.t("How many tables are in this database?");
    static listServersToolConfirmationTitle = vscode_1.l10n.t("List Connections");
    static listServersToolConfirmationMessage = vscode_1.l10n.t(
        "List all connections registered with the mssql extension?",
    );
    static listServersToolInvocationMessage = vscode_1.l10n.t("Listing server connections");
    static connectToolConfirmationTitle = vscode_1.l10n.t("Connect to Server");
    static connectToolConfirmationMessageWithServerOnly = (serverName) => {
        return vscode_1.l10n.t({
            message: "Connect to server {0}?",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    static connectToolConfirmationMessageWithServerAndDatabase = (serverName, databaseName) => {
        return vscode_1.l10n.t({
            message: "Connect to server {0} and database {1}?",
            args: [serverName, databaseName],
            comment: ["{0} is the server name", "{1} is the database name"],
        });
    };
    static connectToolInvocationMessageWithServerOnly = (serverName) => {
        return vscode_1.l10n.t({
            message: "Connecting to server {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    static connectToolInvocationMessageWithServerAndDatabase = (serverName, databaseName) => {
        return vscode_1.l10n.t({
            message: "Connecting to server {0} and database {1}",
            args: [serverName, databaseName],
            comment: ["{0} is the server name", "{1} is the database name"],
        });
    };
    static connectToolServerNotFoundError = (serverName) => {
        return vscode_1.l10n.t({
            message: "Server {0} not found.",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    };
    static connectToolSuccessMessage = vscode_1.l10n.t("Successfully connected to server.");
    static connectToolFailMessage = vscode_1.l10n.t("Failed to connect to server.");
    static connectToolProfileNotFoundError = (profileId) => {
        return vscode_1.l10n.t({
            message: "Connection profile '{0}' not found.",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    static connectToolInvalidInputError = () => {
        return vscode_1.l10n.t("Either profileId or serverName must be provided.");
    };
    static connectToolConfirmationMessageWithProfile = (profileId) => {
        return vscode_1.l10n.t({
            message: "Connect using profile {0}?",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    static connectToolInvocationMessageWithProfile = (profileId) => {
        return vscode_1.l10n.t({
            message: "Connecting using profile {0}",
            args: [profileId],
            comment: ["{0} is the profile ID"],
        });
    };
    static disconnectToolConfirmationTitle = vscode_1.l10n.t("Disconnect");
    static disconnectToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Disconnect from connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static disconnectToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Disconnecting from connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static showSchemaToolConfirmationTitle = vscode_1.l10n.t("Show Schema");
    static showSchemaToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Show schema for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static showSchemaToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Showing schema for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static noConnectionError = (connectionId) => {
        return vscode_1.l10n.t({
            message: "No connection found for connectionId: {0}",
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    };
    static unknownConnection = vscode_1.l10n.t("Unknown Connection");
    static schemaDesignerToolShowSuccessMessage = vscode_1.l10n.t({
        message:
            "Schema designer opened. For schema mutations, continue with {0} operations ({1}/{2}).",
        args: ["mssql_schema_designer", "get_overview", "apply_edits"],
        comment: [
            "{0} is the command identifier 'mssql_schema_designer' and must not be translated",
            "{1} is the operation name 'get_overview' and must not be translated",
            "{2} is the operation name 'apply_edits' and must not be translated",
        ],
    });
    static dabToolShowSuccessMessage = vscode_1.l10n.t({
        message: "Data API builder opened. Continue with {0} operations ({1}/{2}).",
        args: ["mssql_dab", "get_state", "apply_changes"],
        comment: [
            "{0} is the command identifier 'mssql_dab' and must not be translated",
            "{1} is the operation name 'get_state' and must not be translated",
            "{2} is the operation name 'apply_changes' and must not be translated",
        ],
    });
    static schemaDesignerToolConfirmationTitle = vscode_1.l10n.t("Schema Designer");
    static schemaDesignerToolConfirmationMessage = (operation) => {
        return vscode_1.l10n.t({
            message: "Execute '{0}' operation on the schema designer?",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    static schemaDesignerToolInvocationMessage = (operation) => {
        return vscode_1.l10n.t({
            message: "Executing '{0}' operation on schema designer",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    static dabToolConfirmationTitle = vscode_1.l10n.t("Data API builder");
    static dabToolConfirmationMessage = (operation) => {
        return vscode_1.l10n.t({
            message: "Execute '{0}' operation on Data API builder?",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    static dabToolInvocationMessage = (operation) => {
        return vscode_1.l10n.t({
            message: "Executing '{0}' operation on Data API builder",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    static dabToolNoActiveDesigner = vscode_1.l10n.t(
        "No active schema designer found. Please open Data API builder first using mssql_dab with operation 'show' or from the UI.",
    );
    static toolMissingConnectionReference = vscode_1.l10n.t(
        "Missing connection reference. Please provide exactly one of connectionId or connectionName.",
    );
    static toolAmbiguousConnectionReference = vscode_1.l10n.t(
        "Ambiguous connection reference. Please provide only one of connectionId or connectionName.",
    );
    static noSqlToolsMcpConnectionName = (connectionName) => {
        return vscode_1.l10n.t({
            message: "No SQL Tools MCP connection found for connectionName: {0}",
            args: [connectionName],
            comment: ["{0} is the SQL Tools MCP registered connection name"],
        });
    };
    static schemaDesignerNoActiveDesigner = vscode_1.l10n.t(
        "No active schema designer found. Please open one first using mssql_schema_designer with operation 'show' or from the UI.",
    );
    static schemaDesignerStaleState = vscode_1.l10n.t(
        "Schema designer state changed. Fetch the latest schema and retry the operation.",
    );
    static schemaDesignerAddTableSuccess = vscode_1.l10n.t(
        "Table added to schema designer successfully.",
    );
    static schemaDesignerAddTableFailed = vscode_1.l10n.t(
        "Failed to add table to schema designer.",
    );
    static schemaDesignerUpdateTableSuccess = vscode_1.l10n.t(
        "Table updated in schema designer successfully.",
    );
    static schemaDesignerUpdateTableFailed = vscode_1.l10n.t(
        "Failed to update table in schema designer.",
    );
    static schemaDesignerDeleteTableSuccess = vscode_1.l10n.t(
        "Table deleted from schema designer successfully.",
    );
    static schemaDesignerDeleteTableFailed = vscode_1.l10n.t(
        "Failed to delete table from schema designer.",
    );
    static schemaDesignerReplaceSchemaSuccess = vscode_1.l10n.t(
        "Schema designer updated successfully.",
    );
    static schemaDesignerReplaceSchemaFailed = vscode_1.l10n.t("Failed to update schema designer.");
    static schemaDesignerGetSchemaSuccess = vscode_1.l10n.t(
        "Schema designer state retrieved successfully.",
    );
    static schemaDesignerMissingSchema = vscode_1.l10n.t(
        "Missing schema payload for replace_schema operation.",
    );
    static schemaDesignerMissingTable = vscode_1.l10n.t(
        "Missing table payload for update_table operation.",
    );
    static schemaDesignerMissingDeleteTableTarget = vscode_1.l10n.t(
        "Missing table target for delete_table operation. Provide tableId or tableName+schemaName.",
    );
    static schemaDesignerUnknownOperation = (operation) => {
        return vscode_1.l10n.t({
            message:
                "Unknown operation: {0}. Supported operations: add_table, update_table, delete_table, replace_schema, get_schema",
            args: [operation],
            comment: ["{0} is the operation name"],
        });
    };
    static getConnectionDetailsToolConfirmationTitle = vscode_1.l10n.t("Get Connection Details");
    static getConnectionDetailsToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Get connection details for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static getConnectionDetailsToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Getting connection details for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static listDatabasesToolConfirmationTitle = vscode_1.l10n.t("List Databases");
    static listDatabasesToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "List databases for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static listDatabasesToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Listing databases for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static changeDatabaseToolConfirmationTitle = vscode_1.l10n.t("Change Database");
    static changeDatabaseToolConfirmationMessage = (displayName, connectionId, database) => {
        return vscode_1.l10n.t({
            message: "Change database to '{2}' for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId, database],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the database name",
            ],
        });
    };
    static changeDatabaseToolInvocationMessage = (displayName, connectionId, database) => {
        return vscode_1.l10n.t({
            message: "Changing database to '{2}' for connection '{0}' (ID: {1})",
            args: [displayName, connectionId, database],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the database name",
            ],
        });
    };
    static changeDatabaseToolSuccessMessage = (database) => {
        return vscode_1.l10n.t({
            message: "Successfully changed to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    static changeDatabaseToolFailMessage = (database) => {
        return vscode_1.l10n.t({
            message: "Failed to connect to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    static ListTablesToolConfirmationTitle = vscode_1.l10n.t("List Tables");
    static ListTablesToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "List tables for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListTablesToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Listing tables for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListSchemasToolConfirmationTitle = vscode_1.l10n.t("List Schemas");
    static ListSchemasToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "List schemas for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListSchemasToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Listing schemas for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListViewsToolConfirmationTitle = vscode_1.l10n.t("List Views");
    static ListViewsToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "List views for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListViewsToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Listing views for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListFunctionsToolConfirmationTitle = vscode_1.l10n.t("List Functions");
    static ListFunctionsToolConfirmationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "List functions for connection '{0}' (ID: {1})?",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static ListFunctionsToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Listing functions for connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    static RunQueryToolConfirmationTitle = vscode_1.l10n.t("Run Query");
    static RunQueryToolConfirmationMessage = (displayName, connectionId, query) => {
        return vscode_1.l10n.t({
            message: "Run query on connection '{0}' (ID: {1})?\n\nQuery: {2}",
            args: [displayName, connectionId, query],
            comment: [
                "{0} is the connection display name",
                "{1} is the connection ID",
                "{2} is the SQL query",
            ],
        });
    };
    static RunQueryToolInvocationMessage = (displayName, connectionId) => {
        return vscode_1.l10n.t({
            message: "Running query on connection '{0}' (ID: {1})",
            args: [displayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    };
    // Chat Commands localization strings
    static connectedSuccessfully = vscode_1.l10n.t("Connected successfully");
    static failedToConnect = vscode_1.l10n.t("Failed to connect");
    static disconnectedSuccessfully = vscode_1.l10n.t("Disconnected successfully");
    static databaseChangedSuccessfully = vscode_1.l10n.t("Database changed successfully");
    static failedToChangeDatabase = vscode_1.l10n.t("Failed to change database");
    static noActiveConnectionForDatabaseChange = vscode_1.l10n.t(
        "No active connection for database change",
    );
    static connectionDetails = vscode_1.l10n.t("Connection Details");
    static serverLabel = vscode_1.l10n.t("Server");
    static databaseLabel = vscode_1.l10n.t("Database");
    static authentication = vscode_1.l10n.t("Authentication");
    static sqlLogin = vscode_1.l10n.t("SQL Login");
    static serverVersion = vscode_1.l10n.t("Server Version");
    static serverEdition = vscode_1.l10n.t("Server Edition");
    static cloud = vscode_1.l10n.t("Cloud");
    static yes = vscode_1.l10n.t("Yes");
    static no = vscode_1.l10n.t("No");
    static user = vscode_1.l10n.t("User");
    static noConnectionInformationFound = vscode_1.l10n.t("No connection information found");
    static noActiveConnection = vscode_1.l10n.t("No active connection");
    static openingSchemaDesigner = vscode_1.l10n.t("Opening schema designer...");
    static noConnectionCredentialsFound = vscode_1.l10n.t("No connection credentials found");
    static noActiveConnectionForSchemaView = vscode_1.l10n.t(
        "No active connection for schema view",
    );
    static availableServers = vscode_1.l10n.t("Available Servers");
    static noSavedConnectionProfilesFound = vscode_1.l10n.t("No saved connection profiles found.");
    static useConnectToCreateNewConnection = (connectCommand) => {
        return vscode_1.l10n.t({
            message: "Use {0} to create a new connection.",
            args: [connectCommand],
            comment: ["{0} is the connect command"],
        });
    };
    static unnamedProfile = vscode_1.l10n.t("Unnamed Profile");
    static default = vscode_1.l10n.t("Default");
    static foundSavedConnectionProfiles = (count) => {
        return vscode_1.l10n.t({
            message: "Found {0} saved connection profile(s).",
            args: [count],
            comment: ["{0} is the number of connection profiles"],
        });
    };
    static errorRetrievingServerList = (errorMessage) => {
        return vscode_1.l10n.t({
            message: "Error retrieving server list: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    static unknownError = vscode_1.l10n.t("Unknown error");
    static noActiveDatabaseConnection = vscode_1.l10n.t(
        "No active database connection in the current editor. Please establish a connection to continue.",
    );
    static chatCommandNotAvailable = vscode_1.l10n.t(
        "Chat command not available in this VS Code version",
    );
    // Help command strings
    static helpWelcome = vscode_1.l10n.t(
        "👋 I'm GitHub Copilot for MSSQL extension, your intelligent SQL development assistant in Visual Studio Code. I help you connect, explore, design, and evolve your SQL databases directly from VS Code.",
    );
    static helpWhatICanDo = vscode_1.l10n.t("What I can do for you:");
    static helpCapabilityExploreDesign = vscode_1.l10n.t(
        "Explore, design, and evolve database schemas using intelligent, code-first or data-first guidance",
    );
    static helpCapabilityContextualSuggestions = vscode_1.l10n.t(
        "Apply contextual suggestions for SQL syntax, relationships, and constraints",
    );
    static helpCapabilityWriteOptimize = vscode_1.l10n.t(
        "Write, optimize, and troubleshoot SQL queries with AI-recommended improvements",
    );
    static helpCapabilityGenerateMockData = vscode_1.l10n.t(
        "Generate mock data and seed scripts to support testing and development environments",
    );
    static helpCapabilityAccelerateSchema = vscode_1.l10n.t(
        "Accelerate schema evolution by autogenerating ORM migrations or T-SQL change scripts",
    );
    static helpCapabilityUnderstandDocument = vscode_1.l10n.t(
        "Understand and document business logic embedded in stored procedures, views, and functions",
    );
    static helpCapabilitySecurityRecommendations = vscode_1.l10n.t(
        "Get security-related recommendations, such as avoiding SQL injection or excessive permissions",
    );
    static helpCapabilityNaturalLanguage = vscode_1.l10n.t(
        "Receive natural language explanations to help developers unfamiliar with T-SQL understand code",
    );
    static helpCapabilityReverseEngineer = vscode_1.l10n.t(
        "Reverse-engineer existing databases by explaining SQL schemas and relationships",
    );
    static helpCapabilityScaffoldComponents = vscode_1.l10n.t(
        "Scaffold backend components (e.g., data-access layers) based on your current database context",
    );
}
exports.MssqlChatAgent = MssqlChatAgent;
class QueryEditor {
    static codeLensConnect = vscode_1.l10n.t("$(plug)  Connect to MSSQL");
    static queryCancelFailed(errorMessage) {
        return vscode_1.l10n.t({
            message: "Cancel failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
    static queryDisposeFailed(errorMessage) {
        return vscode_1.l10n.t({
            message: "Failed disposing query: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    }
}
exports.QueryEditor = QueryEditor;
class ConnectionSharing {
    static retirementWarning(extensionName) {
        return vscode_1.l10n.t({
            message:
                "The “{0}” extension uses a connection-sharing capability that the MSSQL extension is retiring. File a feature request for the capability you use so we can consider adding it natively.",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    }
    static FileFeatureRequest = vscode_1.l10n.t("File a feature request");
    static DoNotShowAgainForExtension = vscode_1.l10n.t("Don’t show again for this extension");
    static connectionSharingRequestNotification(extensionName) {
        return vscode_1.l10n.t({
            message:
                "The extension '{0}' is requesting access to your SQL Server connections. This will allow it to execute queries and access your database.",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    }
    static Approve = vscode_1.l10n.t("Approve");
    static Deny = vscode_1.l10n.t("Deny");
    static GrantAccess = vscode_1.l10n.t("✅ Grant Access");
    static GrantAccessCurrent = vscode_1.l10n.t("✅ Grant Access (Current)");
    static DenyAccess = vscode_1.l10n.t("❌ Deny Access");
    static DenyAccessCurrent = vscode_1.l10n.t("❌ Deny Access (Current)");
    static AllowThisExtensionToAccessYourConnections = vscode_1.l10n.t(
        "Allow this extension to access your connections",
    );
    static BlockThisExtensionFromAccessingYourConnections = vscode_1.l10n.t(
        "Block this extension from accessing your connections",
    );
    static SelectAnExtensionToManage = vscode_1.l10n.t(
        "Select an extension to manage connection sharing permissions",
    );
    static SelectNewPermission = (extensionName) => {
        return vscode_1.l10n.t({
            message: "Select new permission for extension: '{0}'",
            args: [extensionName],
            comment: ["{0} is the extension name"],
        });
    };
    static ClearAllPermissions = vscode_1.l10n.t(
        "Clear permissions for all extensions to access your connections",
    );
    static Clear = vscode_1.l10n.t("Clear");
    static Cancel = vscode_1.l10n.t("Cancel");
    static AllPermissionsCleared = vscode_1.l10n.t(
        "All permissions for extensions to access your connections have been cleared.",
    );
    static noActiveEditorError = vscode_1.l10n.t(
        "No active text editor found. Please open a file with an active database connection.",
    );
    static connectionNotFoundError(connectionId) {
        return vscode_1.l10n.t({
            message: `Connection with ID "{0}" not found. Please verify the connection ID exists.`,
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    }
    static failedToEstablishConnectionError(connectionId) {
        return vscode_1.l10n.t({
            message: `Failed to establish connection with ID "{0}". Please check connection details and network connectivity.`,
            args: [connectionId],
            comment: ["{0} is the connection ID"],
        });
    }
    static invalidConnectionUri = vscode_1.l10n.t("Invalid connection URI provided.");
    static connectionNotActive = vscode_1.l10n.t(
        "Connection is not active. Please establish a connection before performing this action.",
    );
    static permissionDenied(extensionId) {
        return vscode_1.l10n.t({
            message: `Connection sharing permission denied for extension: '{0}'. Use the permission management commands to change this.`,
            args: [extensionId],
            comment: ["{0} is the extension ID"],
        });
    }
    static permissionRequired(extensionId) {
        return vscode_1.l10n.t({
            message: `Connection sharing permission is required for extension: '{0}'`,
            args: [extensionId],
            comment: ["{0} is the extension ID"],
        });
    }
}
exports.ConnectionSharing = ConnectionSharing;
class ConnectionGroup {
    static createNewGroup = vscode_1.l10n.t("Create Connection Group");
    static editExistingGroup = (groupName) => {
        return vscode_1.l10n.t({
            message: "Edit Connection Group - {0}",
            args: [groupName],
            comment: ["{0} is the connection group name"],
        });
    };
}
exports.ConnectionGroup = ConnectionGroup;
class DacpacDialog {
    static Title = vscode_1.l10n.t("Data-tier Application");
    static FilePathRequired = vscode_1.l10n.t("File path is required");
    static FileNotFound = vscode_1.l10n.t("File not found");
    static InvalidFileExtension = vscode_1.l10n.t(
        "Invalid file extension. Expected .dacpac or .bacpac",
    );
    static DirectoryNotFound = vscode_1.l10n.t("Directory not found");
    static FileAlreadyExists = vscode_1.l10n.t(
        "File already exists. It will be overwritten if you continue",
    );
    static DatabaseNameRequired = vscode_1.l10n.t("Database name is required");
    static InvalidDatabaseName = vscode_1.l10n.t(
        'Database name contains invalid characters. Avoid using: < > * ? " / \\ |',
    );
    static DatabaseNameTooLong = vscode_1.l10n.t(
        "Database name is too long. Maximum length is 128 characters",
    );
    static DatabaseAlreadyExists = vscode_1.l10n.t(
        "A database with this name already exists on the server",
    );
    static DatabaseNotFound = vscode_1.l10n.t("Database not found on the server");
    static ValidationFailed = vscode_1.l10n.t("Validation failed. Please check your inputs");
    static DeployToExistingWarning = vscode_1.l10n.t("Deploy to Existing Database");
    static DeployToExistingMessage = vscode_1.l10n.t(
        "You are about to deploy to an existing database. This operation will make permanent changes to the database schema and may result in data loss. Do you want to continue?",
    );
    static DeployToExistingConfirm = vscode_1.l10n.t("Deploy");
    static Cancel = vscode_1.l10n.t("Cancel");
    static Select = vscode_1.l10n.t("Select");
    static Save = vscode_1.l10n.t("Save");
    static Files = vscode_1.l10n.t("Files");
    static InvalidApplicationVersion = vscode_1.l10n.t(
        "Application version must be in format n.n.n.n where n is a number (e.g., 1.0.0.0)",
    );
    static RevealInExplorer = Common.revealInExplorer;
    static RevealInFinder = Common.revealInFinder;
    static OpenContainingFolder = Common.openContainingFolder;
    static FailedToListDatabases = vscode_1.l10n.t(
        "Unable to retrieve the list of databases. You may not have permission to list databases on this server.",
    );
    static DeploySuccessWithDatabase(databaseName) {
        return vscode_1.l10n.t({
            message: "DACPAC deployed successfully to database '{0}'",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    static ExtractSuccessWithFile(filePath) {
        return vscode_1.l10n.t({
            message: "DACPAC extracted successfully to '{0}'",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    }
    static ImportSuccessWithDatabase(databaseName) {
        return vscode_1.l10n.t({
            message: "BACPAC imported successfully to database '{0}'",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    }
    static ExportSuccessWithFile(filePath) {
        return vscode_1.l10n.t({
            message: "BACPAC exported successfully to '{0}'",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    }
}
exports.DacpacDialog = DacpacDialog;
class SearchDatabase {
    static title = (serverName) =>
        vscode_1.l10n.t({
            message: "Search Database Objects - {0}",
            args: [serverName],
            comment: ["{0} is the server name"],
        });
    static failedToEstablishConnection = vscode_1.l10n.t("Failed to establish connection");
    static typeTable = vscode_1.l10n.t("Table");
    static typeView = vscode_1.l10n.t("View");
    static typeStoredProcedure = vscode_1.l10n.t("Stored Procedure");
    static typeFunction = vscode_1.l10n.t("Function");
    static typeUnknown = vscode_1.l10n.t("Unknown");
    static copiedToClipboard = (objectName) =>
        vscode_1.l10n.t({
            message: 'Copied "{0}" to clipboard',
            args: [objectName],
            comment: ["{0} is the object name"],
        });
    static failedToScriptObject = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to script object: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToOpenEditData = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to open Edit Data: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToOpenModifyTable = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to open Modify Table: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
}
exports.SearchDatabase = SearchDatabase;
class TableExplorer {
    static unableToOpenTableExplorer = vscode_1.l10n.t(
        "Unable to open Table Explorer: No target node provided.",
    );
    static changesSavedSuccessfully = vscode_1.l10n.t("Changes saved successfully.");
    static rowCreatedSuccessfully = vscode_1.l10n.t("Row created.");
    static rowMarkedForRemoval = vscode_1.l10n.t("Row marked for removal.");
    static rowDeletedSuccessfully = vscode_1.l10n.t("Row deleted.");
    static failedToSaveChanges = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to save changes: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToLoadData = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to load data: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToCreateNewRow = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to create a new row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToRemoveRow = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to remove row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToUpdateCell = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to update cell: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToRevertCell = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to revert cell: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToRevertRow = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to revert row: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToGenerateScript = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to generate script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static noScriptToOpen = vscode_1.l10n.t(
        "No script available. Make changes to the table data and generate a script first.",
    );
    static failedToOpenScript = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to open script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static scriptCopiedToClipboard = vscode_1.l10n.t("Script copied to clipboard.");
    static noScriptToCopy = vscode_1.l10n.t(
        "No script available. Make changes to the table data and generate a script first.",
    );
    static failedToCopyScript = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to copy script: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static unsavedChangesPrompt = (tableName) =>
        vscode_1.l10n.t({
            message:
                "Table Explorer for '{0}' has unsaved changes. Do you want to save or discard them?",
            args: [tableName],
            comment: ["{0} is the table name"],
        });
    static Save = vscode_1.l10n.t("Save");
    static Discard = vscode_1.l10n.t("Discard");
    static Cancel = vscode_1.l10n.t("Cancel");
    static exportSuccessful = (filePath) =>
        vscode_1.l10n.t({
            message: "Results exported successfully to {0}",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    static exportFailed = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to export results: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToOpenTableDesigner = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to open Table Designer: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToOpenSchemaDesigner = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to open Schema Designer: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToRunTableQuery = (errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to run table query: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static failedToRunTableQueryUnknown = vscode_1.l10n.t("Failed to run table query.");
    static pendingChangesWillBeLost = vscode_1.l10n.t(
        "Running a custom query will discard all pending changes. Do you want to continue?",
    );
    static Continue = vscode_1.l10n.t("Continue");
}
exports.TableExplorer = TableExplorer;
class AzureDataStudioMigration {
    static PageTitle = vscode_1.l10n.t("Azure Data Studio Migration");
    static SelectConfigFileDialogTitle = vscode_1.l10n.t(
        "Locate an Azure Data Studio settings.json file to import",
    );
    static ImportStatusReady = vscode_1.l10n.t("Ready for import");
    static ConnectionStatusNeedsAttention = vscode_1.l10n.t("Needs attention");
    static ConnectionStatusAlreadyImported = (connectionDisplayName, connectionId) =>
        vscode_1.l10n.t({
            message: "Connection with the same ID is already imported: {0} (ID: {1})",
            args: [connectionDisplayName, connectionId],
            comment: ["{0} is the connection display name", "{1} is the connection ID"],
        });
    static ConnectionGroupStatusAlreadyImported = (groupName, groupId) =>
        vscode_1.l10n.t({
            message: "Connection group with the same ID is already imported: {0} (ID: {1})",
            args: [groupName, groupId],
            comment: ["{0} is the group name", "{1} is the group ID"],
        });
    static connectionIssueMissingSqlPassword = (username) =>
        vscode_1.l10n.t({
            message: "Enter the SQL Login password for user '{0}'.",
            args: [username],
            comment: ["{0} is the SQL Login username"],
        });
    static connectionIssueMissingAzureAccount = (username) =>
        vscode_1.l10n.t({
            message: "Sign in with Entra ID '{0}'.",
            args: [username],
            comment: ["{0} is the Entra ID username"],
        });
    static EntraSignInDialogUnknownAccount = vscode_1.l10n.t("Unknown account");
    static EntraSignInDialogUnknownTenant = vscode_1.l10n.t("Unknown tenant ID");
    static importProgressSuccessMessage = vscode_1.l10n.t(
        "Import complete. You can close this dialog.",
    );
    static importProgressErrorMessage = (error) =>
        vscode_1.l10n.t({
            message: "Import failed: {0}",
            args: [error],
            comment: ["{0} is the error message returned from the import helper."],
        });
    static groupNotSelectedWillBeMovedToRootWarning = vscode_1.l10n.t(
        "This connection's group has not been selected, so this connection will be imported to the root.",
    );
}
exports.AzureDataStudioMigration = AzureDataStudioMigration;
class Changelog {
    static ChangelogDocumentTitle = vscode_1.l10n.t("MSSQL: Welcome & What's New");
    static tryIt = vscode_1.l10n.t("Try it");
    static watchDemo = vscode_1.l10n.t("Watch demo");
    static learnMore = vscode_1.l10n.t("Learn more");
    static watchDemosOnYoutube = vscode_1.l10n.t("Watch demos on YouTube");
    static viewRoadmap = vscode_1.l10n.t("View roadmap");
    static readTheDocumentation = vscode_1.l10n.t("Read docs on Microsoft Learn");
    static joinTheDiscussions = vscode_1.l10n.t("Join the discussions");
    static customizeKeyboardShortcuts = vscode_1.l10n.t("Customize keyboard shortcuts");
    // Main content
    static mainContentTitle = vscode_1.l10n.t("Highlights");
    static schemaDesignerCopilotTitle = vscode_1.l10n.t("Schema Designer with GitHub Copilot");
    static schemaDesignerCopilotDescription = vscode_1.l10n.t(
        "Use natural language to design database schemas directly within the visual Schema Designer. Create schemas from scratch, evolve existing designs, review changes through a diff view, and import external artifacts - all reflected live in the visual diagram and T-SQL script.",
    );
    static shortcutsConfigurationTitle = vscode_1.l10n.t("Shortcuts Configuration");
    static shortcutsConfigurationDescription = vscode_1.l10n.t(
        "Create and manage keyboard shortcuts for frequently used queries, as well as query editor and results grid actions, to discover available commands and execute them more efficiently.",
    );
    static azureSqlProvisioningTitle = vscode_1.l10n.t("Azure SQL databases provisioning");
    static azureSqlProvisioningDescription = vscode_1.l10n.t(
        "Easily start with the Azure SQL database free tier to create and connect to a database directly from your editor at no cost.",
    );
    static dabTitle = vscode_1.l10n.t("Data API builder");
    static dabDescription = vscode_1.l10n.t(
        "Create REST, GraphQL, and MCP endpoints for your SQL database tables from a visual interface within Visual Studio Code. Configure entities, permissions, and deployment settings — then deploy locally with Docker.",
    );
    static dabWithCopilotTitle = vscode_1.l10n.t("Data API builder with GitHub Copilot");
    static dabWithCopilotDescription = vscode_1.l10n.t(
        "Generate REST, GraphQL, and MCP endpoints from your SQL database objects (tables). You can modify the configuration manually or through GitHub Copilot to plan and generate updates - then deploy locally with Docker.",
    );
    static dabCopilotTitle = vscode_1.l10n.t("GitHub Copilot integration in Data API builder");
    static dabCopilotDescription = vscode_1.l10n.t(
        "Generate Data API builder configurations using natural language through GitHub Copilot chat and agent tools. Describe your API requirements and let GitHub Copilot scaffold the configuration for you.",
    );
    static sqlNotebooksTitle = vscode_1.l10n.t("SQL Notebooks");
    static sqlNotebooksDescription = vscode_1.l10n.t(
        "Write and run SQL queries in native Visual Studio Code Jupyter notebooks with interactive results, sorting, filtering, and Markdown documentation.",
    );
    static fabricQueryProfilerTitle = vscode_1.l10n.t("Fabric databases in Query Profiler");
    static fabricQueryProfilerDescription = vscode_1.l10n.t(
        "The Query Profiler now supports SQL database in Microsoft Fabric connections, with new Azure SQL Database templates including {code-snippet-0} for lightweight T-SQL profiling.",
    );
    static adsMigrationTitle = vscode_1.l10n.t(
        "Azure Data Studio Migration Toolkit - Now Including Keymap!",
    );
    static adsMigrationDescription = vscode_1.l10n.t(
        "Migrate saved connections, connection groups, and connection settings from Azure Data Studio into the MSSQL extension. Additionally, the MSSQL Data Management Keymap can be installed to add familiar shortcuts from Azure Data Studio.",
    );
    static dacpacTitle = vscode_1.l10n.t("Data-Tier Application (DACPAC / BACPAC) Import & Export");
    static dacpacDescription = vscode_1.l10n.t(
        "Deploy and extract .dacpac files or import/export .bacpac packages using an integrated, streamlined workflow in the MSSQL extension.",
    );
    // Secondary content
    static secondaryContentTitle = vscode_1.l10n.t("In case you missed it");
    static secondaryContentDescription = vscode_1.l10n.t(
        "Previously released features you may not have explored yet.",
    );
    static editDataTitle = vscode_1.l10n.t("Edit Data");
    static editDataDescription = vscode_1.l10n.t(
        "View, add, edit, and delete table rows in an interactive grid with real-time validation and live DML script previews.",
    );
    static fabricIntegrationTitle = vscode_1.l10n.t("Microsoft Fabric integration");
    static fabricIntegrationDescription = vscode_1.l10n.t(
        "Browse Fabric workspaces and provision SQL databases in Fabric without leaving VS Code.",
    );
    static sqlProjCodeAnalysisTitle = vscode_1.l10n.t("SQL Database Projects — Code Analysis");
    static sqlProjCodeAnalysisDescription = vscode_1.l10n.t(
        "Analyze static code with customizable rulesets in SQL Database Projects.",
    );
    static sqlFormatterTitle = vscode_1.l10n.t("SQL Formatter");
    static sqlFormatterDescription = vscode_1.l10n.t(
        "Format T-SQL with expanded configuration options and greater control over query style and layout using the new SQL Formatter.",
    );
    // Sidebar content
    static resourcesTitle = vscode_1.l10n.t("Resources");
    static resourcesDescription = vscode_1.l10n.t(
        "Explore tutorials, docs, and what's coming next.",
    );
    static feedbackTitle = vscode_1.l10n.t("Feedback");
    static feedbackDescription = vscode_1.l10n.t("Help us improve by sharing your thoughts.");
    static openNewBug = vscode_1.l10n.t("Open a new bug");
    static requestNewFeature = vscode_1.l10n.t("Request a new feature");
    static copilotSurvey = vscode_1.l10n.t("GitHub Copilot survey");
    static gettingStartedTitle = vscode_1.l10n.t("Getting Started");
    static gettingStartedDescription = vscode_1.l10n.t(
        "New to the MSSQL extension? Check out our quick-start guide.",
    );
    static mssqlWalkthrough = vscode_1.l10n.t("MSSQL - VS Code walkthrough");
    static copilotWalkthrough = vscode_1.l10n.t("GitHub Copilot - VS Code walkthrough");
    // Event banner
    static sqlconEuDescription1 = vscode_1.l10n.t(
        "Discover how SQL Database in Fabric, Azure SQL, and SQL Server are redefining modern app development. Join engineers and peers pushing the limits of performance, AI integration, and developer productivity.",
    );
    static sqlconEuDescription2 = vscode_1.l10n.t(
        "Use discount code {0} to save €200 on registration.",
    );
    static sqlconEuRegister = vscode_1.l10n.t("Register");
}
exports.Changelog = Changelog;
class Profiler {
    // Error messages
    static failedToLaunchProfiler = (error) =>
        vscode_1.l10n.t({
            message: "Failed to launch profiler: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static failedToStartProfiler = (error) =>
        vscode_1.l10n.t({
            message: "Failed to start profiler: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static failedToCreateSession = (error) =>
        vscode_1.l10n.t({
            message: "Failed to create profiler session: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static connectionError = (error) =>
        vscode_1.l10n.t({
            message: "Connection error: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static failedToConnect = vscode_1.l10n.t("Failed to connect to the selected server.");
    static noConnectionAvailable = vscode_1.l10n.t("No profiler connection available");
    static noSavedConnections = vscode_1.l10n.t(
        "No saved connections found. Please create a connection first.",
    );
    static noTemplatesAvailable = vscode_1.l10n.t("No profiler templates available");
    static sessionCreationTimedOut = vscode_1.l10n.t("Session creation timed out");
    // XEL file error messages
    static failedToOpenXelFile = (error) =>
        vscode_1.l10n.t({
            message: "Failed to open XEL file: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static invalidXelFile = vscode_1.l10n.t("The selected file is not a valid XEL file.");
    static xelFileNotFound = vscode_1.l10n.t("The XEL file was not found.");
    static xelFileAccessDenied = vscode_1.l10n.t("Access to the XEL file was denied.");
    // Validation messages
    static sessionNameEmpty = vscode_1.l10n.t("Session name cannot be empty");
    static sessionNameTooLong = (maxLength) =>
        vscode_1.l10n.t({
            message: "Session name must be {0} characters or less",
            args: [maxLength],
            comment: ["{0} is the maximum length"],
        });
    static sessionNameInvalidChars = vscode_1.l10n.t(
        "Session name can only contain letters, numbers, underscores, and hyphens",
    );
    // Quick pick and input prompts
    static selectTemplate = vscode_1.l10n.t("Select a profiler template");
    static newSessionSelectTemplate = vscode_1.l10n.t("New Query Profiler - Select Template");
    static enterSessionName = vscode_1.l10n.t("Enter a name for the new profiler session");
    static sessionNamePlaceholder = vscode_1.l10n.t("MyProfilerSession");
    static newSessionEnterName = vscode_1.l10n.t("New Query Profiler - Enter Name");
    static engineLabel = (engineType) =>
        vscode_1.l10n.t({
            message: "Engine: {0}",
            args: [engineType],
            comment: ["{0} is the engine type"],
        });
    static selectXelFile = vscode_1.l10n.t("Select XEL File");
    static xelFileFilter = vscode_1.l10n.t("Extended Events Log Files");
    // Success messages
    static sessionCreatedSuccessfully = (sessionName) =>
        vscode_1.l10n.t({
            message: "Profiler session '{0}' created successfully. Starting profiling...",
            args: [sessionName],
            comment: ["{0} is the session name"],
        });
    static sessionStartedSuccessfully = (sessionName) =>
        vscode_1.l10n.t({
            message: "Profiler session '{0}' started successfully.",
            args: [sessionName],
            comment: ["{0} is the session name"],
        });
    static profilerReady = vscode_1.l10n.t(
        "Profiler ready. Select a session from the dropdown and click Start to begin profiling.",
    );
    static stoppingSession = (sessionName) =>
        vscode_1.l10n.t({
            message: 'Stopping profiler session "{0}"...',
            args: [sessionName],
            comment: ["{0} is the session name"],
        });
    static loadingXelFile = (fileName) =>
        vscode_1.l10n.t({
            message: "Loading XEL file: {0}",
            args: [fileName],
            comment: ["{0} is the file name"],
        });
    static xelFileReadOnlyDisconnectedNotification = (fileName) =>
        vscode_1.l10n.t({
            message:
                "Profiler is in read-only and disconnected mode for XEL file '{0}' and cannot start or create live sessions without a database connection.",
            args: [fileName],
            comment: ["{0} is the file name"],
        });
    static xelFileReadOnlyDisconnectedTooltip = (fileName) =>
        vscode_1.l10n.t({
            message:
                "Profiler is in read-only and disconnected mode for XEL file '{0}' and cannot start or create live sessions without a database connection",
            args: [fileName],
            comment: ["{0} is the file name"],
        });
    // Status bar
    static statusBarNoSession = vscode_1.l10n.t("Query Profiler: No session");
    static statusBarTooltip = vscode_1.l10n.t("Query Profiler Session Status");
    // Panel titles
    static panelTitleWithSession = (name) =>
        vscode_1.l10n.t({
            message: "Query Profiler: {0}",
            args: [name],
            comment: ["{0} is the file name or session name"],
        });
    static panelTitleDefault = vscode_1.l10n.t("Query Profiler");
    static stateRunning = vscode_1.l10n.t("Running");
    static statePaused = vscode_1.l10n.t("Paused");
    static stateStopped = vscode_1.l10n.t("Stopped");
    static stateNotStarted = vscode_1.l10n.t("Not Started");
    static stateReadOnly = vscode_1.l10n.t("Read-Only");
    static eventsCount = (count) =>
        vscode_1.l10n.t({
            message: "{0} events",
            args: [count],
            comment: ["{0} is the number of events"],
        });
    static eventsCountFiltered = (filtered, total) =>
        vscode_1.l10n.t({
            message: "{0}/{1} events",
            args: [filtered, total],
            comment: ["{0} is the filtered count, {1} is the total count"],
        });
    static fileSessionLabel = (fileName) =>
        vscode_1.l10n.t({
            message: "File: {0}",
            args: [fileName],
            comment: ["{0} is the file name"],
        });
    // Details panel
    static failedToOpenInEditor = (error) =>
        vscode_1.l10n.t({
            message: "Failed to open text in editor: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    // Export messages
    static defaultExportFileName = vscode_1.l10n.t("profiler_events");
    static exportToCsv = vscode_1.l10n.t("Export to CSV");
    static exportSuccess = (filePath) =>
        vscode_1.l10n.t({
            message: "Profiler events exported successfully to {0}",
            args: [filePath],
            comment: ["{0} is the file path"],
        });
    static openFile = Common.openFile;
    static exportFailed = (error) =>
        vscode_1.l10n.t({
            message: "Failed to export profiler events: {0}",
            args: [error],
            comment: ["{0} is the error message"],
        });
    static copiedToClipboard = vscode_1.l10n.t("Copied to clipboard");
    // Close prompt messages
    static unexportedEventsMessage = vscode_1.l10n.t(
        "You have captured Profiler events that have not been exported. If you close now, you will lose all captured events. Do you want to export them to a CSV file?",
    );
    static exportAndClose = vscode_1.l10n.t("Export & Close");
    static closeWithoutExport = vscode_1.l10n.t("Close Without Export");
    static closeSessionConfirmation = vscode_1.l10n.t(
        "Are you sure you want to close the current session? All captured events will be lost. You can export events to CSV from the toolbar before closing.",
    );
    // Database selection for Azure SQL
    static selectDatabaseForProfiler = vscode_1.l10n.t(
        "Select a database for profiling (Azure SQL requires a specific database)",
    );
    static noDatabasesFound = vscode_1.l10n.t(
        "No databases found on the server. Please check your connection.",
    );
}
exports.Profiler = Profiler;
class BackupDatabase {
    static backupDatabaseTitle = (databaseName) =>
        vscode_1.l10n.t({
            message: "Backup Database - {0}",
            args: [databaseName],
            comment: ["{0} is the database name"],
        });
    static backupName = vscode_1.l10n.t("Backup Name");
    static recoveryModel = vscode_1.l10n.t("Recovery Model");
    static full = vscode_1.l10n.t("Full");
    static bulkLogged = vscode_1.l10n.t("Bulk-logged");
    static simple = vscode_1.l10n.t("Simple");
    static backupType = vscode_1.l10n.t("Backup Type");
    static differential = vscode_1.l10n.t("Differential");
    static transactionLog = vscode_1.l10n.t("Transaction Log");
    static copyOnly = vscode_1.l10n.t("Copy-only Backup");
    static saveToUrl = vscode_1.l10n.t("Save backup to URL");
    static azureAccount = vscode_1.l10n.t("Azure Account");
    static azureAccountIsRequired = vscode_1.l10n.t("Azure Account is required");
    static tenant = vscode_1.l10n.t("Tenant");
    static tenantIsRequired = vscode_1.l10n.t("Tenant is required");
    static storageAccount = vscode_1.l10n.t("Storage Account");
    static storageAccountIsRequired = vscode_1.l10n.t("Storage Account is required");
    static selectAStorageAccount = vscode_1.l10n.t("Select a storage account");
    static blobContainer = vscode_1.l10n.t("Blob Container");
    static selectABlobContainer = vscode_1.l10n.t("Select a blob container");
    static blobContainerIsRequired = vscode_1.l10n.t("Blob Container is required");
    static subscription = vscode_1.l10n.t("Subscription");
    static selectASubscription = vscode_1.l10n.t("Select a subscription");
    static subscriptionIsRequired = vscode_1.l10n.t("Subscription is required");
    static backupFiles = vscode_1.l10n.t("Backup Files");
    static compression = vscode_1.l10n.t("Compression");
    static backupCompression = vscode_1.l10n.t("Set backup Compression");
    static useDefault = vscode_1.l10n.t("Use the default server setting");
    static compressBackup = vscode_1.l10n.t("Compress backup");
    static doNotCompressBackup = vscode_1.l10n.t("Do not compress backup");
    static media = vscode_1.l10n.t("Media");
    static append = vscode_1.l10n.t("Append to the existing backup set");
    static overwrite = vscode_1.l10n.t("Overwrite all existing backup sets");
    static create = vscode_1.l10n.t("Backup to a new media set");
    static unavailableForBackupsToExistingFiles = vscode_1.l10n.t(
        "Unavailable for backups to existing files",
    );
    static pleaseChooseValidMediaOption = vscode_1.l10n.t("Please choose a valid media option");
    static backupMediaSet = vscode_1.l10n.t("Set backup Media Set");
    static newMediaSetName = vscode_1.l10n.t("New media set name");
    static mediaSetNameIsRequired = vscode_1.l10n.t("Media set name is required");
    static newMediaSetDescription = vscode_1.l10n.t("New media set description");
    static mediaSetDescriptionIsRequired = vscode_1.l10n.t("Media set description is required");
    static reliability = vscode_1.l10n.t("Reliability");
    static performChecksum = vscode_1.l10n.t("Perform checksum before writing to media");
    static verifyBackup = vscode_1.l10n.t("Verify backup when finished");
    static continueOnError = vscode_1.l10n.t("Continue on error");
    static truncateLog = vscode_1.l10n.t("Truncate the transaction log");
    static backupTail = vscode_1.l10n.t("Backup the tail of the log");
    static expiration = vscode_1.l10n.t("Expiration");
    static retainDays = vscode_1.l10n.t("Set backup retain days");
    static encryption = vscode_1.l10n.t("Encryption");
    static enableEncryption = vscode_1.l10n.t("Use encryption for this backup");
    static encryptionAlgorithm = vscode_1.l10n.t("Encryption Algorithm");
    static encryptionType = vscode_1.l10n.t("Encryption Type");
    static backupFileTypes = vscode_1.l10n.t("Backup Files (*.bak, *.log, *.trn)");
    static allFiles = vscode_1.l10n.t("All Files (*.*)");
    static noTenantsFound = vscode_1.l10n.t("No tenants found");
    static noSubscriptionsFound = vscode_1.l10n.t("No subscriptions found");
    static noStorageAccountsFound = vscode_1.l10n.t("No storage accounts found");
    static noBlobContainersFound = vscode_1.l10n.t("No blob containers found");
    static generatingSASKeyFailedWithError = (errorMessage) => {
        return vscode_1.l10n.t({
            message: "Generating SAS key failed: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    };
    static unableToLoadBackupConfig = vscode_1.l10n.t(
        "Unable to load backup configuration. Please try again.",
    );
    static couldNotConnectToDatabase = (database) => {
        return vscode_1.l10n.t({
            message: "Could not connect to database: {0}",
            args: [database],
            comment: ["{0} is the database name"],
        });
    };
    static azureSqlDbNotSupported = vscode_1.l10n.t(
        "Azure SQL Database is not supported for backup.",
    );
}
exports.BackupDatabase = BackupDatabase;
class FlatFileImport {
    static serviceStarting = (serviceName) =>
        vscode_1.l10n.t({
            message: "Starting '{0}'...",
            args: [serviceName],
            comment: ["{0} is the service name"],
        });
    static serviceStarted = (serviceName) =>
        vscode_1.l10n.t({
            message: "'{0}' started.",
            args: [serviceName],
            comment: ["{0} is the service name"],
        });
    static serviceStartFailed = (serviceName, errorMessage) =>
        vscode_1.l10n.t({
            message: "Failed to start '{0}': {1}",
            args: [serviceName, errorMessage],
            comment: ["{0} is the service name", "{1} is the error message"],
        });
    static flatFileImportTitle = vscode_1.l10n.t("Import Flat File");
    static databaseTheTableIsCreatedIn = vscode_1.l10n.t("Database the table is created in");
    static locationOfTheFileToBeImported = vscode_1.l10n.t("Location of the file to be imported");
    static newTableName = vscode_1.l10n.t("New Table Name");
    static tableSchema = vscode_1.l10n.t("Table Schema");
    static importFileTypes = vscode_1.l10n.t("CSV/TXT Files (*.csv;*.txt)");
    static noDatabasesFoundToImportInto = vscode_1.l10n.t("No databases found to import into.");
    static selectFileToImport = vscode_1.l10n.t("Select file to import");
    static databaseRequired = vscode_1.l10n.t("Database is required");
    static importFileRequired = vscode_1.l10n.t("Import file is required");
    static tableNameRequired = vscode_1.l10n.t("Table name is required");
    static schemaRequired = vscode_1.l10n.t("Schema is required");
    static fetchTablePreviewError = vscode_1.l10n.t("Error fetching the table preview.");
    static fetchSchemasError = vscode_1.l10n.t("Error fetching schemas for the selected database.");
    static loadingSchemas = vscode_1.l10n.t("Loading schemas...");
    static noSchemasFound = vscode_1.l10n.t("No schemas found");
    static importFailed = vscode_1.l10n.t("Failed to import file.");
    static flatFilePathTooltip = vscode_1.l10n.t(
        "Please ensure the file is not open in another application before importing",
    );
}
exports.FlatFileImport = FlatFileImport;
class RestoreDatabase {
    static restoreDatabaseTitle = vscode_1.l10n.t("Restore Database");
    static sourceDatabase = vscode_1.l10n.t("Source Database");
    static targetDatabase = vscode_1.l10n.t("Target Database");
    static files = vscode_1.l10n.t("Files");
    static relocateDbFiles = vscode_1.l10n.t("Relocate all files");
    static general = vscode_1.l10n.t("General");
    static overwriteExistingDb = vscode_1.l10n.t("Overwrite the existing database");
    static overwriteExistingDbTooltip = vscode_1.l10n.t(
        "Uses the WITH REPLACE option during restore",
    );
    static preserveReplicationSettings = vscode_1.l10n.t("Preserve the replication settings");
    static preserveReplicationSettingsTooltip = vscode_1.l10n.t(
        "Uses the WITH KEEP_REPLICATION option during restore",
    );
    static restrictAccessToRestoredDb = vscode_1.l10n.t("Restrict access to the restored database");
    static restrictAccessToRestoredDbTooltip = vscode_1.l10n.t(
        "Uses the WITH RESTRICTED_USER option during restore",
    );
    static recoveryState = vscode_1.l10n.t("Recovery state");
    static restoreWithRecovery = vscode_1.l10n.t("RESTORE WITH RECOVERY");
    static restoreWithNoRecovery = vscode_1.l10n.t("RESTORE WITH NORECOVERY");
    static restoreWithStandby = vscode_1.l10n.t("RESTORE WITH STANDBY");
    static dataFileFolder = vscode_1.l10n.t("Data file folder");
    static logFileFolder = vscode_1.l10n.t("Log file folder");
    static standbyFile = vscode_1.l10n.t("Standby file");
    static tailLogBackup = vscode_1.l10n.t("Tail-log backup");
    static takeTailLogBackup = vscode_1.l10n.t("Take tail-log backup before restore");
    static leaveSourceDatabase = vscode_1.l10n.t(
        "Leave the source database in the restoring state",
    );
    static leaveSourceDatabaseTooltip = vscode_1.l10n.t(
        "Uses the WITH NORECOVERY option during restore",
    );
    static tailLogBackupFile = vscode_1.l10n.t("Tail-log backup file");
    static serverConnections = vscode_1.l10n.t("Server Connections");
    static closeExistingConnections = vscode_1.l10n.t(
        "Close existing connections to destination database",
    );
    static blob = vscode_1.l10n.t("Blob");
    static selectABlob = vscode_1.l10n.t("Select a blob");
    static blobIsRequired = vscode_1.l10n.t("Blob is required");
    static blobDatabaseError = vscode_1.l10n.t("Blob does not contain a valid database backup");
    static noBlobsFound = vscode_1.l10n.t("No blobs found");
    static backupFileDatabaseError = vscode_1.l10n.t(
        "Selected backup file does not contain a valid database backup",
    );
    static cannotGenerateScriptWithNoRestorePlan = vscode_1.l10n.t(
        "Cannot generate script without a restore plan",
    );
    static pleaseChooseAtLeastOneBackupSetToRestore = vscode_1.l10n.t(
        "Please choose at least one backup set to restore",
    );
    static noDatabasesWithBackups = vscode_1.l10n.t("No databases with backups found");
    static azureSqlDbNotSupported = vscode_1.l10n.t(
        "Azure SQL Database is not supported for restore.",
    );
}
exports.RestoreDatabase = RestoreDatabase;
class ServiceClient {
    static runtimeNotFoundError = vscode_1.l10n.t(
        "A required .NET runtime could not be found or installed.",
    );
    static unableToStartService = (errorMessage) =>
        vscode_1.l10n.t({
            message:
                "The SQL Server extension couldn't start because its required background service failed to launch. Install the offline VSIX for your operating system, or check your network connection and try again. Details: {0}",
            args: [errorMessage],
            comment: ["{0} is the error message"],
        });
    static downloadOfflineVsix = vscode_1.l10n.t("Download offline VSIX");
    static copyLinkToClipboard = vscode_1.l10n.t("Copy link");
    static linkCopiedToClipboard = vscode_1.l10n.t("Link copied to clipboard");
    static serviceCrashed = (name, error) =>
        vscode_1.l10n.t({
            message: "The {0} service has crashed. Details: {1}",
            args: [name, error],
            comment: ["{0} is the service name", "{1} is the error message"],
        });
    static viewKnownIssues = vscode_1.l10n.t("View known issues");
    static installFailedStatusText = vscode_1.l10n.t("Service installation failed.");
}
exports.ServiceClient = ServiceClient;
class Formatter {
    static parseError = vscode_1.l10n.t(
        "SQL formatting could not be completed because the T-SQL could not be fully parsed. If you believe the syntax is valid, please send feedback.",
    );
    static sendFeedback = vscode_1.l10n.t("Send Feedback");
}
exports.Formatter = Formatter;
exports.azureSignInFailed = vscode_1.l10n.t("Azure sign in failed.");
exports.selectSubscriptions = vscode_1.l10n.t("Select subscriptions");
exports.errorLoadingAzureSubscriptions = vscode_1.l10n.t("Error loading Azure subscriptions.");
exports.azureSubscriptionNotFoundInCache = vscode_1.l10n.t(
    "Azure subscription not found in cache.",
);
function invalidConnectionString0(arg0) {
    return vscode_1.l10n.t("Invalid connection string: {0}", arg0);
}
exports.serializationFailed = vscode_1.l10n.t("Serialization failed");
exports.azureMFA = vscode_1.l10n.t("Azure MFA");
exports.windowsAuthentication = vscode_1.l10n.t("Windows Authentication");
exports.enabled = vscode_1.l10n.t("Enabled");
exports.disabled = vscode_1.l10n.t("Disabled");
exports.server = vscode_1.l10n.t("Server");
exports.database = vscode_1.l10n.t("Database");
exports.authenticationType = vscode_1.l10n.t("Authentication Type");
exports.user = vscode_1.l10n.t("User");
exports.port = vscode_1.l10n.t("Port");
exports.sqlContainerName = vscode_1.l10n.t("SQL Container Name");
exports.sqlContainerVersion = vscode_1.l10n.t("SQL Container Version");
exports.applicationIntent = vscode_1.l10n.t("Application Intent");
exports.connectionTimeout = vscode_1.l10n.t("Connection Timeout");
exports.commandTimeout = vscode_1.l10n.t("Command Timeout");
exports.alwaysEncrypted = vscode_1.l10n.t("Always Encrypted");
exports.replication = vscode_1.l10n.t("Replication");
function loc0Filtered(arg0) {
    return vscode_1.l10n.t("{0} (filtered)", arg0);
}
exports.objectExplorerFilter = vscode_1.l10n.t("Object Explorer Filter");
exports.descriptionForTheTable = vscode_1.l10n.t("Description for the table.");
exports.description = vscode_1.l10n.t("Description");
exports.theNameOfTheColumnObject = vscode_1.l10n.t("The name of the column object.");
exports.name = vscode_1.l10n.t("Name");
exports.displaysTheDescriptionOfTheColumn = vscode_1.l10n.t(
    "Displays the description of the column",
);
exports.description2 = vscode_1.l10n.t("Description");
exports.displaysTheUnifiedDataTypeIncludingLength = vscode_1.l10n.t(
    "Displays the unified data type (including length, scale and precision) for the column",
);
exports.dataType = vscode_1.l10n.t("Data Type");
exports.displaysTheDataTypeNameForThe = vscode_1.l10n.t(
    "Displays the data type name for the column",
);
exports.typeLabel = vscode_1.l10n.t("Type");
exports.theMaximumLengthInCharactersThatCan = vscode_1.l10n.t(
    "The maximum length (in characters) that can be stored in this database object.",
);
exports.length = vscode_1.l10n.t("Length");
exports.aPredefinedGlobalDefaultValueForThe = vscode_1.l10n.t(
    "A predefined global default value for the column or binding.",
);
exports.defaultValue = vscode_1.l10n.t("Default Value");
exports.specifiesWhetherTheColumnMayHaveA = vscode_1.l10n.t(
    "Specifies whether the column may have a NULL value.",
);
exports.allowNulls = vscode_1.l10n.t("Allow Nulls");
exports.specifiesWhetherTheColumnIsIncludedIn = vscode_1.l10n.t(
    "Specifies whether the column is included in the primary key for the table.",
);
exports.primaryKey = vscode_1.l10n.t("Primary Key");
exports.forNumericDataTheMaximumNumberOf = vscode_1.l10n.t(
    "For numeric data, the maximum number of decimal digits that can be stored in this database object.",
);
exports.precision = vscode_1.l10n.t("Precision");
exports.forNumericDataTheMaximumNumberOf2 = vscode_1.l10n.t(
    "For numeric data, the maximum number of decimal digits that can be stored in this database object to the right of decimal point.",
);
exports.scale = vscode_1.l10n.t("Scale");
exports.columns = vscode_1.l10n.t("Columns");
exports.column = vscode_1.l10n.t("Column");
exports.newColumn = vscode_1.l10n.t("New Column");
exports.theNameOfTheColumn = vscode_1.l10n.t("The name of the column.");
exports.column2 = vscode_1.l10n.t("Column");
exports.nameOfThePrimaryKey = vscode_1.l10n.t("Name of the primary key.");
exports.name2 = vscode_1.l10n.t("Name");
exports.theDescriptionOfThePrimaryKey = vscode_1.l10n.t("The description of the primary key.");
exports.description3 = vscode_1.l10n.t("Description");
exports.columnsInThePrimaryKey = vscode_1.l10n.t("Columns in the primary key.");
exports.primaryKeyColumns = vscode_1.l10n.t("Primary Key Columns");
exports.primaryKeyColumns2 = vscode_1.l10n.t("Primary Key Columns");
exports.addColumn = vscode_1.l10n.t("Add Column");
exports.theNameOfTheColumn2 = vscode_1.l10n.t("The name of the column.");
exports.column3 = vscode_1.l10n.t("Column");
exports.theNameOfTheIndex = vscode_1.l10n.t("The name of the index.");
exports.name3 = vscode_1.l10n.t("Name");
exports.theDescriptionOfTheIndex = vscode_1.l10n.t("The description of the index.");
exports.description4 = vscode_1.l10n.t("Description");
exports.theColumnsOfTheIndex = vscode_1.l10n.t("The columns of the index.");
exports.columns2 = vscode_1.l10n.t("Columns");
exports.addColumn2 = vscode_1.l10n.t("Add Column");
exports.indexes = vscode_1.l10n.t("Indexes");
exports.index = vscode_1.l10n.t("Index");
exports.newIndex = vscode_1.l10n.t("New Index");
exports.foreignColumn = vscode_1.l10n.t("Foreign Column");
exports.column4 = vscode_1.l10n.t("Column");
exports.theNameOfTheForeignKey = vscode_1.l10n.t("The name of the foreign key.");
exports.name4 = vscode_1.l10n.t("Name");
exports.theDescriptionOfTheForeignKey = vscode_1.l10n.t("The description of the foreign key.");
exports.description5 = vscode_1.l10n.t("Description");
exports.theTableWhichContainsThePrimaryOr = vscode_1.l10n.t(
    "The table which contains the primary or unique key column.",
);
exports.foreignTable = vscode_1.l10n.t("Foreign Table");
exports.theBehaviorWhenAUserTriesTo = vscode_1.l10n.t(
    "The behavior when a user tries to update a row with data that is involved in a foreign key relationship.",
);
exports.onUpdateAction = vscode_1.l10n.t("On Update Action");
exports.theBehaviorWhenAUserTriesTo2 = vscode_1.l10n.t(
    "The behavior when a user tries to delete a row with data that is involved in a foreign key relationship.",
);
exports.onDeleteAction = vscode_1.l10n.t("On Delete Action");
exports.theMappingBetweenForeignKeyColumnsAnd = vscode_1.l10n.t(
    "The mapping between foreign key columns and primary key columns.",
);
exports.columns3 = vscode_1.l10n.t("Columns");
exports.columns4 = vscode_1.l10n.t("Columns");
exports.newColumnMapping = vscode_1.l10n.t("New Column Mapping");
exports.foreignKeys = vscode_1.l10n.t("Foreign Keys");
exports.foreignKey = vscode_1.l10n.t("Foreign Key");
exports.newForeignKey = vscode_1.l10n.t("New Foreign Key");
exports.theNameOfTheCheckConstraint = vscode_1.l10n.t("The name of the check constraint.");
exports.name5 = vscode_1.l10n.t("Name");
exports.theDescriptionOfTheCheckConstraint = vscode_1.l10n.t(
    "The description of the check constraint.",
);
exports.description6 = vscode_1.l10n.t("Description");
exports.theExpressionDefiningTheCheckConstraint = vscode_1.l10n.t(
    "The expression defining the check constraint.",
);
exports.expression = vscode_1.l10n.t("Expression");
exports.checkConstraints = vscode_1.l10n.t("Check Constraints");
exports.checkConstraint = vscode_1.l10n.t("Check Constraint");
exports.newCheckConstraint = vscode_1.l10n.t("New Check Constraint");
exports.columns5 = vscode_1.l10n.t("Columns");
exports.primaryKey2 = vscode_1.l10n.t("Primary Key");
exports.indexes2 = vscode_1.l10n.t("Indexes");
exports.foreignKeys2 = vscode_1.l10n.t("Foreign Keys");
exports.checkConstraints2 = vscode_1.l10n.t("Check Constraints");
exports.advancedOptions = vscode_1.l10n.t("Advanced Options");
class SqlSymbolRename {
    static renameNotSupportedAtPosition = vscode_1.l10n.t(
        "Rename is not supported at this position.",
    );
    static renameOnlyInProjectFiles = vscode_1.l10n.t(
        "Rename is only supported for SQL files that are part of an open SQL project. Open the project in the Database Projects panel first.",
    );
    static renameNotSupportedForSymbol = vscode_1.l10n.t("Please select a valid symbol.");
    static renameRequestFailed = (message) =>
        vscode_1.l10n.t("Rename request failed: {0}", message);
    static noRenameableSymbolAtCursor = vscode_1.l10n.t("No renameable symbol found at cursor.");
}
exports.SqlSymbolRename = SqlSymbolRename;
class SqlMoveToSchema {
    static moveToSchemaTitle = vscode_1.l10n.t("Move to Schema...");
    static moveToSchemaOnlyInProjectFiles = vscode_1.l10n.t(
        "Move to Schema is only supported for SQL files that are part of an open SQL project. Open the project in the Database Projects panel first.",
    );
    static selectTargetSchemaPlaceholder = (currentSchema) =>
        currentSchema
            ? vscode_1.l10n.t("Current Schema: {0}, Select the new schema:", currentSchema)
            : vscode_1.l10n.t("Select the target schema");
    static noSchemasFound = vscode_1.l10n.t("No schemas were found in the project.");
    static noMovableSymbolAtCursor = vscode_1.l10n.t(
        "No object that can be moved to another schema was found at the cursor.",
    );
    static moveToSchemaRequestFailed = (message) =>
        vscode_1.l10n.t("Move to Schema request failed: {0}", message);
    static resolveRefactorLogFailed = (message) =>
        vscode_1.l10n.t("Failed to resolve the refactor log for this file: {0}", message);
    static previewLabel = (targetSchema) => vscode_1.l10n.t("Move to schema '{0}'", targetSchema);
    static moveFileFailed = (message) =>
        vscode_1.l10n.t("Failed to move file to the new schema folder: {0}", message);
    static moveFileRejected = vscode_1.l10n.t("The move was rejected or could not be completed.");
    static sqlprojUpdateFailed = (message) =>
        vscode_1.l10n.t("Failed to update the .sqlproj after moving the file: {0}", message);
}
exports.SqlMoveToSchema = SqlMoveToSchema;
/** Strings for the Projects workspace surface (src/dataWorkspace). */
class DataWorkspace {
    static ExtensionActivationError = (extensionId, err) => {
        return vscode_1.l10n.t(
            "Failed to load the project provider extension '{0}'. Error message: {1}",
            extensionId,
            getErrorMessage(err),
        );
    };
    static UnknownProjectsError = (projectFiles) => {
        return vscode_1.l10n.t(
            "No provider was found for the following projects: {0}",
            projectFiles.join(EOL),
        );
    };
    static SelectProjectFileActionName = vscode_1.l10n.t("Select");
    static AllProjectTypes = vscode_1.l10n.t("All Project Types");
    static ProviderNotFoundForProjectTypeError = (projectType) => {
        return vscode_1.l10n.t(
            "No provider was found for project type with id: '{0}'",
            projectType,
        );
    };
    static projectFailedToLoad = (project, error) => {
        return vscode_1.l10n.t(
            "Project '{0}' failed to load: {1}  To view more details, [open the developer console](command:workbench.action.toggleDevTools).",
            project,
            error,
        );
    };
    static fileDoesNotExist = (name) => {
        return vscode_1.l10n.t("File '{0}' doesn't exist", name);
    };
    static projectNameNull = vscode_1.l10n.t("Project name is null");
    static noPreviousData = (tableName) => {
        return vscode_1.l10n.t(
            "Prior {0} for the current project will appear here, please run to see the results.",
            tableName,
        );
    };
    static gitCloneMessage = (url) => {
        return vscode_1.l10n.t("Cloning git repository '{0}'...", url);
    };
    static gitCloneError = vscode_1.l10n.t(
        "Error during git clone. View git output for more details",
    );
    static openedProjectsUndefinedAfterRefresh = vscode_1.l10n.t(
        "List of opened projects should not be undefined after refresh from disk.",
    );
    static dragAndDropNotSupported = vscode_1.l10n.t(
        "This project type does not support drag and drop.",
    );
    static onlyMovingOneFileIsSupported = vscode_1.l10n.t(
        "Only moving one file at a time is supported.",
    );
    static noProjectProvidingExtensionsInstalled = vscode_1.l10n.t(
        "No database project extensions are installed. Please install a database project extension to use this feature.",
    );
    // UI
    static OkButtonText = vscode_1.l10n.t("OK");
    static BrowseButtonText = vscode_1.l10n.t("Browse");
    static BrowseEllipsis = vscode_1.l10n.t("Browse...");
    static OpenButtonText = vscode_1.l10n.t("Open");
    static CreateButtonText = vscode_1.l10n.t("Create");
    static Select = vscode_1.l10n.t("Select");
    // New Project Dialog
    static NewProjectDialogTitle = vscode_1.l10n.t("Create new database project");
    static TypeTitle = vscode_1.l10n.t("Type");
    static ProjectNameTitle = vscode_1.l10n.t("Name");
    static ProjectNamePlaceholder = vscode_1.l10n.t("Enter project name");
    static EnterProjectName = vscode_1.l10n.t("Enter Project Name");
    static ProjectLocationTitle = vscode_1.l10n.t("Location");
    static ProjectLocationPlaceholder = vscode_1.l10n.t("Select location to create project");
    static ProjectParentDirectoryNotExistError = (location) => {
        return vscode_1.l10n.t(
            "The selected project location '{0}' does not exist or is not a directory.",
            location,
        );
    };
    static ProjectDirectoryAlreadyExistError = (projectName, location) => {
        return vscode_1.l10n.t(
            "There is already a directory named '{0}' in the selected location: '{1}'.",
            projectName,
            location,
        );
    };
    static ProjectDirectoryAlreadyExistErrorShort = (projectName) => {
        return vscode_1.l10n.t(
            "Directory '{0}' already exists in the selected location, please choose another",
            projectName,
        );
    };
    static SelectProjectType = vscode_1.l10n.t("Select Database Project Type");
    static SelectProjectLocation = vscode_1.l10n.t("Select Project Location");
    static NameCannotBeEmpty = vscode_1.l10n.t("Name cannot be empty");
    static TargetPlatform = vscode_1.l10n.t("Target Platform");
    static SdkStyleProject = vscode_1.l10n.t("SDK-style project");
    static LearnMore = vscode_1.l10n.t("Learn More");
    static YesRecommended = vscode_1.l10n.t("Yes (Recommended)");
    static No = vscode_1.l10n.t("No");
    static Yes = vscode_1.l10n.t("Yes");
    static SdkLearnMorePlaceholder = vscode_1.l10n.t(
        'Click "Learn More" button for more information about SDK-style projects',
    );
    static Default = vscode_1.l10n.t("Default");
    static SelectTargetPlatform = vscode_1.l10n.t("Select Target Platform");
    static LocalDevInfo = (target) =>
        vscode_1.l10n.t(
            'Click "Learn more" button for more information about local development experience to {0}',
            target,
        );
    static undefinedFilenameErrorMessage = vscode_1.l10n.t("Undefined name");
    static filenameEndingIsPeriodErrorMessage = vscode_1.l10n.t(
        "File name cannot end with a period",
    );
    static whitespaceFilenameErrorMessage = vscode_1.l10n.t("File name cannot be whitespace");
    static invalidFileCharsErrorMessage = vscode_1.l10n.t("Invalid file characters");
    static reservedWindowsFilenameErrorMessage = vscode_1.l10n.t(
        "This file name is reserved for use by Windows. Choose another name and try again",
    );
    static reservedValueErrorMessage = vscode_1.l10n.t(
        "Reserved file name. Choose another name and try again",
    );
    static trailingWhitespaceErrorMessage = vscode_1.l10n.t(
        "File name cannot start or end with whitespace",
    );
    static tooLongFilenameErrorMessage = vscode_1.l10n.t("File name cannot be over 255 characters");
    static confirmCreateProjectWithBuildTaskDialogName = vscode_1.l10n.t(
        "Do you want to configure SQL project build as the default build configuration for this folder?",
    );
    //Open Existing Dialog
    static OpenExistingDialogTitle = vscode_1.l10n.t("Open Existing Project");
    static FileNotExistError = (fileType, filePath) => {
        return vscode_1.l10n.t(
            "The selected {0} file '{1}' does not exist or is not a file.",
            fileType,
            filePath,
        );
    };
    static CloneParentDirectoryNotExistError = (location) => {
        return vscode_1.l10n.t(
            "The selected clone path '{0}' does not exist or is not a directory.",
            location,
        );
    };
    static Project = vscode_1.l10n.t("Project");
    static LocationSelectorTitle = vscode_1.l10n.t("Location");
    static ProjectFilePlaceholder = vscode_1.l10n.t("Select project file");
    static WorkspacePlaceholder = vscode_1.l10n.t(
        "Select workspace ({0}) file",
        WorkspaceFileExtension,
    );
    static ProjectAlreadyOpened = (path) => {
        return vscode_1.l10n.t("Project '{0}' is already opened.", path);
    };
    static Local = vscode_1.l10n.t("Local");
    static RemoteGitRepo = vscode_1.l10n.t("Remote git repository");
    static GitRepoUrlTitle = vscode_1.l10n.t("Git repository URL");
    static GitRepoUrlPlaceholder = vscode_1.l10n.t("Enter remote git repository URL");
    static LocalClonePathTitle = vscode_1.l10n.t("Local clone path");
    static LocalClonePathPlaceholder = vscode_1.l10n.t(
        "Select location to clone repository locally",
    );
    static ProjectFileTitle = vscode_1.l10n.t("Project file");
    // Dashboard dialog
    static Refresh = vscode_1.l10n.t("Refresh");
}
exports.DataWorkspace = DataWorkspace;
//# sourceMappingURL=locConstants.js.map
