/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { l10n } from 'vscode';
import * as path from 'path';
import { SqlTargetPlatform } from 'sqldbproj';
import * as utils from './utils';

//#region file extensions
export const dataSourcesFileName = 'datasources.json';
export const sqlprojExtension = '.sqlproj';
export const sqlFileExtension = '.sql';
export const publishProfileExtension = '.publish.xml';
export const openApiSpecFileExtensions = ['yaml', 'yml', 'json'];

//#endregion

//#region Placeholder values
export const schemaCompareExtensionId = 'microsoft.schema-compare';
export const master = 'master';
export const msdb = 'msdb';
export const MicrosoftDatatoolsSchemaSqlSql = 'Microsoft.Data.Tools.Schema.Sql.Sql';
export const databaseSchemaProvider = 'DatabaseSchemaProvider';
export const sqlProjectSdk = 'Microsoft.Build.Sql';
export const problemMatcher = '$sqlproj-problem-matcher';
export const sqlProjTaskType = 'sqlproj-build';
export const dotnet = 'dotnet';
export const build = 'build';
export const runCodeAnalysisParam = '/p:RunSqlCodeAnalysis=true';

//#endregion

//#region Project Provider
export const emptySqlDatabaseProjectTypeId = 'EmptySqlDbProj';
export const emptyProjectTypeDisplayName = l10n.t("SQL Server Database");
export const emptyProjectTypeDescription = l10n.t("Develop and publish schemas for SQL Server databases starting from an empty project");

export const edgeSqlDatabaseProjectTypeId = 'SqlDbEdgeProj';
export const edgeProjectTypeDisplayName = l10n.t("Azure SQL Edge Database");
export const edgeProjectTypeDescription = l10n.t("Start with the core pieces to develop and publish schemas for Azure SQL Edge Database");

export const emptySqlDatabaseSdkProjectTypeId = 'EmptySqlDbSdkProj';
export const emptySdkProjectTypeDisplayName = l10n.t("SQL Database (SDK)");
export const emptySdkProjectTypeDescription = l10n.t("Develop and publish schemas for SQL databases with Microsoft.Build.Sql, starting from an empty SDK-style project.");

export const emptyAzureDbSqlDatabaseProjectTypeId = 'EmptyAzureSqlDbProj';
export const emptyAzureDbProjectTypeDisplayName = l10n.t("Azure SQL Database");
export const emptyAzureDbProjectTypeDescription = l10n.t("Develop and publish schemas for Azure SQL Database starting from an empty project");

//#endregion

//#region Dashboard
export const addItemAction = l10n.t("Add Item");
export const schemaCompareAction = l10n.t("Schema Compare");
export const buildAction = l10n.t("Build");
export const publishAction = l10n.t("Publish");
export const changeTargetPlatformAction = l10n.t("Change Target Platform");

export const Status = l10n.t("Status");
export const Time = l10n.t("Time");
export const Date = l10n.t("Date");
export const TargetPlatform = l10n.t("Target Platform");
export const TargetServer = l10n.t("Target Server");
export const TargetDatabase = l10n.t("Target Database");
export const BuildHistory = l10n.t("Build History");
export const PublishHistory = l10n.t("Publish History");

export const Success = l10n.t("Success");
export const Failed = l10n.t("Failed");
export const InProgress = l10n.t("In progress");

export const hr = l10n.t("hr");
export const min = l10n.t("min");
export const sec = l10n.t("sec");
export const msec = l10n.t("msec");

export const at = l10n.t("at");

//#endregion

//#region commands
export const revealFileInOsCommand = 'revealFileInOS';
export const schemaCompareStartCommand = 'schemaCompare.start';
export const schemaCompareRunComparisonCommand = 'schemaCompare.runComparison';
export const mssqlSchemaCompareCommand = 'mssql.schemaCompare';
export const mssqlPublishProjectCommand = 'mssql.publishDatabaseProject';
export const vscodeOpenCommand = 'vscode.open';
export const refreshDataWorkspaceCommand = 'dataworkspace.refresh';

//#endregion

//#region UI Strings
export const databaseReferencesNodeName = l10n.t("Database References");
export const sqlcmdVariablesNodeName = l10n.t("SQLCMD Variables");
export const sqlConnectionStringFriendly = l10n.t("SQL connection string");
export const yesString = l10n.t("Yes");
export const openEulaString = l10n.t("Open License Agreement");
export const noString = l10n.t("No");
export const noStringDefault = l10n.t("No (default)");
export const okString = l10n.t("Ok");
export const selectString = l10n.t("Select");
export const selectFileString = l10n.t("Select File");
export const dacpacFiles = l10n.t("dacpac Files");
export const publishSettingsFiles = l10n.t("Publish Settings File");
export const file = l10n.t("File");
export const flat = l10n.t("Flat");
export const objectType = l10n.t("Object Type");
export const schema = l10n.t("Schema");
export const schemaObjectType = l10n.t("Schema/Object Type");
export const defaultProjectNameStarter = l10n.t("DatabaseProject");
export const location = l10n.t("Location");
export const reloadProject = l10n.t("Would you like to reload your database project?");
export const learnMore = l10n.t("Learn More");
export const sdkLearnMoreUrl = 'https://aka.ms/sqlprojsdk';
export const azureDevOpsLink = 'https://docs.microsoft.com/azure/azure-sql/database/local-dev-experience-overview?view=azuresql';
export function newObjectNamePrompt(objectType: string) { return l10n.t('New {0} name:', objectType); }
export function deleteConfirmation(toDelete: string) { return l10n.t("Are you sure you want to delete {0}?", toDelete); }
export function deleteConfirmationContents(toDelete: string) { return l10n.t("Are you sure you want to delete {0} and all of its contents?", toDelete); }
export function deleteReferenceConfirmation(toDelete: string) { return l10n.t("Are you sure you want to delete the reference to {0}?", toDelete); }
export function deleteSqlCmdVariableConfirmation(toDelete: string) { return l10n.t("Are you sure you want to delete the SQLCMD Variable '{0}'?", toDelete); }
export function selectTargetPlatform(currentTargetPlatform: string) { return l10n.t("Current target platform: {0}. Select new target platform", currentTargetPlatform); }
export function currentTargetPlatform(projectName: string, currentTargetPlatform: string) { return l10n.t("Target platform of the project {0} is now {1}", projectName, currentTargetPlatform); }
export function projectUpdatedToSdkStyle(projectName: string) { return l10n.t("The project {0} has been updated to be an SDK-style project. Click 'Learn More' for details on the Microsoft.Build.Sql SDK and ways to simplify the project file.", projectName); }
export function convertToSdkStyleConfirmation(projectName: string) { return l10n.t("The project '{0}' will not be fully compatible with SSDT after conversion. A backup copy of the project file will be created in the project folder prior to conversion. More information is available at https://aka.ms/sqlprojsdk. Continue with converting to SDK-style project?", projectName); }
export function updatedToSdkStyleError(projectName: string) { return l10n.t("Converting the project {0} to SDK-style was unsuccessful. Changes to the .sqlproj have been rolled back.", projectName); }
export const enterNewName = l10n.t("Enter new name");
//#endregion

export const illegalSqlCmdChars = ['$', '@', '#', '"', '\'', '-'];
export const reservedProjectFolders = ['Properties', 'SQLCMD Variables', 'Database References'];

//#region Publish dialog strings
export const publishDialogName = l10n.t("Publish project");
export const publish = l10n.t("Publish");
export const cancelButtonText = l10n.t("Cancel");
export const generateScriptButtonText = l10n.t("Generate Script");
export const databaseNameLabel = l10n.t("Database");
export const targetConnectionLabel = l10n.t("Connection");
export const dataSourceRadioButtonLabel = l10n.t("Data sources");
export const connectionRadioButtonLabel = l10n.t("Connections");
export const dataSourceDropdownTitle = l10n.t("Data source");
export const noDataSourcesText = l10n.t("No data sources in this project");
export const loadProfilePlaceholderText = l10n.t("Load profile...");
export const profileReadError = (err: any) => l10n.t("Error loading the publish profile. {0}", utils.getErrorMessage(err));
export const sqlCmdVariables = l10n.t("SQLCMD Variables");
export const sqlCmdVariableColumn = l10n.t("Name");
export const sqlCmdValueColumn = l10n.t("Value");
export const revertSqlCmdVarsButtonTitle = l10n.t("Revert values to project defaults");
export const profile = l10n.t("Profile");
export const selectConnection = l10n.t("Select connection");
export const server = l10n.t("Server");
export const defaultUser = l10n.t("default");
export const selectProfileToUse = l10n.t("Select publish profile to load");
export const selectProfile = l10n.t("Select Profile");
export const saveProfileAsButtonText = l10n.t("Save As...");
export const save = l10n.t("Save");
export const dontUseProfile = l10n.t("Don't use profile");
export const browseForProfileWithIcon = `$(folder) ${l10n.t("Browse for profile")}`;
export const chooseAction = l10n.t("Choose action");
export const chooseSqlcmdVarsToModify = l10n.t("Choose SQLCMD variables to modify");
export const enterNewValueForVar = (varName: string) => l10n.t("Enter new default value for variable '{0}'", varName);
export const enterNewSqlCmdVariableName = l10n.t("Enter new SQLCMD Variable name");
export const enterNewSqlCmdVariableDefaultValue = (varName: string) => l10n.t("Enter default value for SQLCMD variable '{0}'", varName);
export const addSqlCmdVariableWithoutDefaultValue = (varName: string) => l10n.t("Add SQLCMD variable '{0}' to project without default value?", varName);
export const sqlcmdVariableAlreadyExists = l10n.t("A SQLCMD Variable with the same name already exists in this project");
export const resetAllVars = l10n.t("Reset all variables");
export const createNew = l10n.t("Create New");
export const enterNewDatabaseName = l10n.t("Enter new database name");
export const newText = l10n.t("New");
export const selectDatabase = l10n.t("Select database");
export const done = l10n.t("Done");
export const nameMustNotBeEmpty = l10n.t("Name must not be empty");
export const versionMustNotBeEmpty = l10n.t("Version must not be empty");
export const saveProfile = l10n.t("Would you like to save the settings in a profile (.publish.xml)?");

//#endregion

//#region Publish Dialog options
export const AdvancedOptionsButton = l10n.t('Advanced...');
export const AdvancedPublishOptions = l10n.t('Advanced Publish Options');
export const PublishOptions = l10n.t('Publish Options');
export const ExcludeObjectTypeTab = l10n.t('Exclude Object Types');
export const ResetButton: string = l10n.t("Reset");
export const OptionDescription: string = l10n.t("Option Description");
export const OptionName: string = l10n.t("Option Name");
export const OptionInclude: string = l10n.t("Include");
export function OptionNotFoundWarningMessage(label: string) { return l10n.t("label: {0} does not exist in the options value name lookup", label); }

//#endregion

//#region Deploy
export const SqlServerName = 'SQL server';
export const AzureSqlServerName = 'Azure SQL server';
export const SqlServerDockerImageName = 'Microsoft SQL Server';
export const SqlServerDocker2022ImageName = 'Microsoft SQL Server 2022';
export const AzureSqlDbFullDockerImageName = 'Microsoft SQL Server';
export const AzureSqlLogicalServerName = 'Azure SQL logical server';
export const selectPublishOption = l10n.t("Select where to publish the project to");
export const defaultQuickPickItem = l10n.t("Default - image defined as default in the container registry");
export function publishToExistingServer(name: string) { return l10n.t("Publish to an existing {0}", name); }
export function publishToDockerContainer(name: string) { return l10n.t("Publish to new {0} local development container", name); }
export function publishToDockerContainerPreview(name: string) { return l10n.t("Publish to new {0} local development container (Preview)", name); }
export const publishToAzureEmulator = l10n.t("Publish to new SQL Server local development container");
export const publishToNewAzureServer = l10n.t("Publish to new Azure SQL logical server (Preview)");
export const azureServerName = l10n.t("Azure SQL server name");
export const azureSubscription = l10n.t("Azure subscription");
export const resourceGroup = l10n.t("Resource group");
export const azureLocation = l10n.t("Location");
export const azureAccounts = l10n.t("Azure accounts");
export function enterPortNumber(name: string) { return l10n.t("Enter {0} port number or press enter to use the default value", name); }
export function serverPortNumber(name: string) { return l10n.t("{0} port number", name); }
export function serverPassword(name: string) { return l10n.t("{0} admin password", name); }
export function confirmServerPassword(name: string) { return l10n.t("Confirm {0} admin password", name); }
export function baseDockerImage(name: string) { return l10n.t("Base {0} Docker image", name); }
export const publishTo = l10n.t("Publish Target");
export const enterConnectionStringEnvName = l10n.t("Enter connection string environment variable name");
export const enterConnectionStringTemplate = l10n.t("Enter connection string template");
export function enterUser(name: string) { return l10n.t("Enter {0} admin user name", name); }
export function enterPassword(name: string) { return l10n.t("Enter {0} admin password", name); }
export function confirmPassword(name: string) { return l10n.t("Confirm {0} admin password", name); }
export function selectBaseImage(name: string) { return l10n.t("Select the base {0} docker image", name); }
export function selectImageTag(name: string) { return l10n.t("Select the image tag or press enter to use the default value", name); }
export function invalidSQLPasswordMessage(name: string) { return l10n.t("{0} password doesn't meet the password complexity requirement. For more information see https://docs.microsoft.com/sql/relational-databases/security/password-policy", name); }
export function passwordNotMatch(name: string) { return l10n.t("{0} password doesn't match the confirmation password", name); }
export const portMustBeNumber = l10n.t("Port must a be number");
export const valueCannotBeEmpty = l10n.t("Value cannot be empty");
export const imageTag = l10n.t("Image tag");
export const dockerImageLabelPrefix = 'source=sqldbproject';
export const dockerImageNamePrefix = 'sqldbproject';
export const dockerImageDefaultTag = 'latest';

//#endregion

//#region Publish to Container
export const eulaAgreementTemplate = l10n.t({ message: "I accept the {0}.", comment: ['The placeholders are contents of the line and should not be translated.'] });
export function eulaAgreementText(name: string) { return l10n.t({ message: "I accept the {0}.", args: [name], comment: ['The placeholders are contents of the line and should not be translated.'] }); }
export const eulaAgreementTitle = l10n.t("Microsoft SQL Server License Agreement");
export const sqlServerEulaLink = 'https://aka.ms/mcr/osslegalnotice';
export const connectionNamePrefix = 'SQLDbProject';
export const sqlServerDockerRegistry = 'mcr.microsoft.com';
export const sqlServerDockerRepository = 'mssql/server';
export const commandsFolderName = 'commands';
export const mssqlFolderName = '.mssql';
export const dockerFileName = 'Dockerfile';
export const startCommandName = 'start.sh';
export const defaultPortNumber = '1433';
export const defaultLocalServerName = 'localhost';
export const defaultLocalServerAdminName = 'sa';
export const defaultConnectionStringEnvVarName = 'SQLConnectionString';
export const defaultConnectionStringTemplate = 'Data Source=@@SERVER@@,@@PORT@@;Initial Catalog=@@DATABASE@@;User id=@@USER@@;Password=@@SA_PASSWORD@@;';
export const azureFunctionLocalSettingsFileName = 'local.settings.json';
export const enterConnStringTemplateDescription = l10n.t("Enter a template for SQL connection string");
export const appSettingPrompt = l10n.t("Would you like to update Azure Function local.settings.json with the new connection string?");
export const enterConnectionStringEnvNameDescription = l10n.t("Enter environment variable for SQL connection string");
export const deployDbTaskName = l10n.t("Deploying SQL Db Project Locally");
export const publishProjectSucceed = l10n.t("Database project published successfully");
export const publishingProjectMessage = l10n.t("Publishing project in a container...");
export const cleaningDockerImagesMessage = l10n.t("Cleaning existing deployments...");
export const dockerImageMessage = l10n.t("Docker Image:");
export const dockerImageEulaMessage = l10n.t("License Agreement:");
export const creatingDeploymentSettingsMessage = l10n.t("Creating deployment settings ...");
export const runningDockerMessage = l10n.t("Running the docker container ...");
export function dockerNotRunningError(error: string) { return l10n.t("Failed to verify docker. Please make sure docker is installed and running. Error: '{0}'", error || ''); }
export const dockerContainerNotRunningErrorMessage = l10n.t("Docker container is not running");
export const dockerContainerFailedToRunErrorMessage = l10n.t("Failed to run the docker container");
export const connectingToSqlServerMessage = l10n.t("Connecting to SQL Server");
export const serverCreated = l10n.t("Server created");
export const deployProjectFailedMessage = l10n.t("Failed to open a connection to the deployed database'");
export const containerAlreadyExistForProject = l10n.t("Containers already exist for this project. Do you want to delete them before deploying a new one?");
export const checkoutOutputMessage = l10n.t("Check output pane for more details");
export function creatingAzureSqlServer(name: string): string { return l10n.t("Creating Azure SQL Server '{0}' ...", name); }
export function azureSqlServerCreated(name: string): string { return l10n.t("Azure SQL Server '{0}' created", name); }
export function taskFailedError(taskName: string, err: string): string { return l10n.t("Failed to complete task '{0}'. Error: {1}", taskName, err); }
export function publishToContainerFailed(errorMessage: string) { return l10n.t("Failed to publish to container. {0}", errorMessage); }
export function publishToNewAzureServerFailed(errorMessage: string) { return l10n.t("Failed to publish to new Azure SQL server. {0}", errorMessage); }
export function deployAppSettingUpdateFailed(appSetting: string) { return l10n.t("Failed to update app setting '{0}'", appSetting); }
export function deployAppSettingUpdating(appSetting: string) { return l10n.t("Updating app setting: '{0}'", appSetting); }
export function connectionFailedError(error: string) { return l10n.t("Connection failed error: '{0}'", error); }
export function dockerContainerCreatedMessage(id: string) { return l10n.t("Docker created id: '{0}'", id); }
export function dockerLogMessage(log: string) { return l10n.t("Docker logs: '{0}'", log); }
export function retryWaitMessage(numberOfSeconds: number, name: string) { return l10n.t("Waiting for {0} seconds before another attempt for operation '{1}'", numberOfSeconds, name); }
export function retryRunMessage(attemptNumber: number, numberOfAttempts: number, name: string) { return l10n.t("Running operation '{2}' Attempt {0} of {1}", attemptNumber, numberOfAttempts, name); }
export function retrySucceedMessage(name: string, result: string) { return l10n.t("Operation '{0}' completed successfully. Result: {1}", name, result); }
export function retryFailedMessage(name: string, result: string, error: string) { return l10n.t("Operation '{0}' failed. Re-trying... Current Result: {1}. Error: '{2}'", name, result, error); }
export function retryMessage(name: string, error: string) { return l10n.t("Operation '{0}' failed. Re-trying... Error: '{1}' ", name, error); }

//#endregion

//#region Add Database Reference dialog strings
export const addDatabaseReferenceDialogName = l10n.t("Add database reference");
export const addDatabaseReferenceOkButtonText = l10n.t("Add reference");
export const referenceRadioButtonsGroupTitle = l10n.t("Referenced Database Type");
export const projectLabel = l10n.t("Project");
export const systemDatabase = l10n.t("System database");
export const dacpacText = l10n.t("Data-tier application (.dacpac)");
export const nupkgText = l10n.t("Published data-tier application (.nupkg)");
export const nupkgNamePlaceholder = l10n.t("NuGet package name");
export const version = l10n.t("Version");
export const versionPlaceholder = l10n.t("NuGet package version");
export const selectDacpac = l10n.t("Select .dacpac");
export const sameDatabase = l10n.t("Same database");
export const differentDbSameServer = l10n.t("Different database, same server");
export const differentDbDifferentServer = l10n.t("Different database, different server");
export const systemDbLocationDropdownValues = [differentDbSameServer];
export const locationDropdownValues = [sameDatabase, differentDbSameServer, differentDbDifferentServer];
export const databaseName = l10n.t("Database name");
export const databaseVariable = l10n.t("Database variable");
export const serverName = l10n.t("Server name");
export const serverVariable = l10n.t("Server variable");
export const suppressMissingDependenciesErrors = l10n.t("Suppress errors caused by unresolved references in the referenced project");
export const exampleUsage = l10n.t("Example Usage");
export const enterSystemDbName = l10n.t("Enter a database name for this system database");
export const databaseNameRequiredVariableOptional = l10n.t("A database name is required. The database variable is optional.");
export const databaseNameServerNameVariableRequired = l10n.t("A database name, server name, and server variable are required. The database variable is optional");
export const otherServer = 'OtherServer';
export const otherSeverVariable = 'OtherServer';
export const databaseProject = l10n.t("Database project");
export const dacpacMustBeOnSameDrive = l10n.t("Dacpac references need to be located on the same drive as the project file.");
export const dacpacNotOnSameDrive = (projectLocation: string): string => { return l10n.t("Dacpac references need to be located on the same drive as the project file. The project file is located at {0}", projectLocation); };
export const referencedDatabaseType = l10n.t("Referenced Database type");
export const excludeFolderNotSupported = l10n.t("Excluding folders is not yet supported");
export const unhandledDeleteType = (itemType: string): string => { return l10n.t("Unhandled item type during delete: '{0}", itemType); }
export const unhandledExcludeType = (itemType: string): string => { return l10n.t("Unhandled item type during exclude: '{0}", itemType); }
export const artifactReference = l10n.t("Artifact Reference");
export const packageReference = l10n.t("Package Reference");
export const referenceTypeRadioButtonsGroupTitle = l10n.t("Reference Type");


//#endregion

//#region Create Project From Database dialog strings
export const createProjectFromDatabaseDialogName = l10n.t("Create project from database");
export const createProjectDialogOkButtonText = l10n.t("Create");
export const sourceDatabase = l10n.t("Source database");
export const targetProject = l10n.t("Target project");
export const createProjectSettings = l10n.t("Settings");
export const projectNameLabel = l10n.t("Name");
export const projectNamePlaceholderText = l10n.t("Enter project name");
export const projectLocationLabel = l10n.t("Location");
export const projectLocationPlaceholderText = l10n.t("Select location to create project");
export const browseButtonText = l10n.t("Browse folder");
export const selectFolderStructure = l10n.t("Select folder structure");
export const folderStructureLabel = l10n.t("Folder structure");
export const includePermissionsLabel = l10n.t("Include permissions");
export const includePermissionsInProject = l10n.t("Include permissions in project");
export const browseEllipsisWithIcon = `$(folder) ${l10n.t("Browse...")}`;
export const selectProjectLocation = l10n.t("Select project location");
export const sdkStyleProject = l10n.t('SDK-style project');
export const YesRecommended = l10n.t("Yes (Recommended)");
export const SdkLearnMorePlaceholder = l10n.t("Click \"Learn More\" button for more information about SDK-style projects");
export const ProjectParentDirectoryNotExistError = (location: string): string => { return l10n.t("The selected project location '{0}' does not exist or is not a directory.", location); };
export const ProjectDirectoryAlreadyExistError = (projectName: string, location: string): string => { return l10n.t("There is already a directory named '{0}' in the selected location: '{1}'.", projectName, location); };
export const confirmCreateProjectWithBuildTaskDialogName = l10n.t("Do you want to configure SQL project build as the default build configuration for this folder?");
export const buildTaskName = l10n.t("Build");
export const buildWithCodeAnalysisTaskName = l10n.t("Build with Code Analysis");

//#endregion

//#region Update Project From Database dialog strings
export const updateProjectFromDatabaseDialogName = l10n.t("Update project from database");
export const updateText = l10n.t("Update");
export const noSqlProjFile = l10n.t("The selected project file does not exist");
export const noSchemaCompareExtension = l10n.t("The Schema Compare extension must be installed to a update a project from a database.");
export const projectToUpdatePlaceholderText = l10n.t("Select project file");
export const updateAction = l10n.t("Update action");
export const compareActionRadioButtonLabel = l10n.t("View changes in Schema Compare");
export const updateActionRadioButtonLabel = l10n.t("Apply all changes");
export const actionLabel = l10n.t("Action");
export const applyConfirmation: string = l10n.t("Are you sure you want to update the target project?");
export const selectProjectFile: string = l10n.t("Select project file");

//#endregion

//#region Update project from database
export const applySuccess = l10n.t("Project was successfully updated.");
export const equalComparison = l10n.t("The project is already up to date with the database.");
export function applyError(errorMessage: string): string { return l10n.t("There was an error updating the project: {0}", errorMessage); }
export function updatingProjectFromDatabase(projectName: string, databaseName: string): string { return l10n.t("Updating {0} from {1}...", projectName, databaseName); }

//#endregion

//#region Error messages
export function errorPrefix(errorMessage: string): string { return l10n.t("Error: {0}", errorMessage); }
export function compareErrorMessage(errorMessage: string): string { return l10n.t("Schema Compare failed: {0}", errorMessage ? errorMessage : 'Unknown'); }
export const multipleSqlProjFiles = l10n.t("Multiple .sqlproj files selected; please select only one.");
export const noSqlProjFiles = l10n.t("No .sqlproj file selected; please select one.");
export const noDataSourcesFile = l10n.t("No {0} found", dataSourcesFileName);
export const missingVersion = l10n.t("Missing 'version' entry in {0}", dataSourcesFileName);
export const unrecognizedDataSourcesVersion = l10n.t("Unrecognized version: ");
export const unknownDataSourceType = l10n.t("Unknown data source type: ");
export const invalidSqlConnectionString = l10n.t("Invalid SQL connection string");
export const extractTargetRequired = l10n.t("Target information for extract is required to create database project.");
export const schemaCompareNotInstalled = l10n.t("Schema compare extension installation is required to run schema compare");
export const buildFailedCannotStartSchemaCompare = l10n.t("Schema compare could not start because build failed");
export function projectNeedsUpdatingForCrossPlat(projectName: string) { return l10n.t("The targets, references, and system database references need to be updated to build the project '{0}'.", projectName); }
export function updateProjectForCrossPlatform(projectName: string) { return l10n.t("{0} If the project was created in SSDT, it will continue to work in both tools. Do you want to update the project?", projectNeedsUpdatingForCrossPlat(projectName)); }
export function updateProjectForCrossPlatformShort(projectName: string) { return l10n.t("Update {0} for cross-platform support?", projectName); }
export function updateProjectDatabaseReferencesForCrossPlatform(projectName: string) { return l10n.t("The system database references need to be updated to build the project '{0}'. If the project was created in SSDT, it will continue to work in both tools. Do you want to update the project?", projectName); }
export const databaseReferenceTypeRequired = l10n.t("Database reference type is required for adding a reference to a database");
export const systemDatabaseReferenceRequired = l10n.t("System database selection is required for adding a reference to a system database");
export const dacpacFileLocationRequired = l10n.t("Dacpac file location is required for adding a reference to a database");
export const databaseLocationRequired = l10n.t("Database location is required for adding a reference to a database");
export const databaseNameRequired = l10n.t("Database name is required for adding a reference to a different database");
export const invalidDataSchemaProvider = l10n.t("Invalid DSP in .sqlproj file");
export const invalidDatabaseReference = l10n.t("Invalid database reference in .sqlproj file");
export const databaseSelectionRequired = l10n.t("Database selection is required to create a project from a database");
export const databaseReferenceAlreadyExists = l10n.t("A reference to this database already exists in this project");
export const outsideFolderPath = l10n.t("Items with absolute path outside project folder are not supported. Please make sure the paths in the project file are relative to project folder.");
export const parentTreeItemUnknown = l10n.t("Cannot access parent of provided tree item");
export const prePostDeployCount = l10n.t("To successfully build, update the project to have one pre-deployment script and/or one post-deployment script");
export const invalidProjectReload = l10n.t("Cannot access provided database project. Only valid, open database projects can be reloaded.");
export const externalStreamingJobValidationPassed = l10n.t("Validation of external streaming job passed.");
export const errorRetrievingBuildFiles = l10n.t("Could not build project. Error retrieving files needed to build.");

export function projectAlreadyOpened(path: string) { return l10n.t("Project '{0}' is already opened.", path); }
export function projectAlreadyExists(name: string, path: string) { return l10n.t("A project named {0} already exists in {1}.", name, path); }
export function noFileExist(fileName: string) { return l10n.t("File {0} doesn't exist", fileName); }
export function fileOrFolderDoesNotExist(name: string) { return l10n.t("File or directory '{0}' doesn't exist", name); }
export function cannotResolvePath(path: string) { return l10n.t("Cannot resolve path {0}", path); }
export function fileAlreadyExists(filename: string) { return l10n.t("A file with the name '{0}' already exists on disk at this location. Please choose another name.", filename); }
export function folderAlreadyExists(filename: string) { return l10n.t("A folder with the name '{0}' already exists on disk at this location. Please choose another name.", filename); }
export function folderAlreadyExistsChooseNewLocation(filename: string) { return l10n.t("A folder with the name '{0}' already exists on disk at this location. Please choose another location.", filename); }
export function invalidInput(input: string) { return l10n.t("Invalid input: {0}", input); }
export function invalidProjectPropertyValueInSqlProj(propertyName: string) { return l10n.t("Invalid value specified for the property '{0}' in .sqlproj file", propertyName); }
export function invalidProjectPropertyValueProvided(propertyName: string) { return l10n.t("Project property value '{0} is invalid", propertyName); }
export function unableToCreatePublishConnection(input: string) { return l10n.t("Unable to construct connection: {0}", input); }
export function circularProjectReference(project1: string, project2: string) { return l10n.t("Circular reference from project {0} to project {1}", project1, project2); }
export function errorFindingBuildFilesLocation(err: any) { return l10n.t("Error finding build files location: {0}", utils.getErrorMessage(err)); }
export function projBuildFailed(errorMessage: string) { return l10n.t("Build failed. Check output pane for more details. {0}", errorMessage); }
export function unexpectedProjectContext(uri: string) { return l10n.t("Unable to establish project context.  Command invoked from unexpected location: {0}", uri); }
export function unableToPerformAction(action: string, uri: string, error?: string) { return l10n.t("Unable to locate '{0}' target: '{1}'. {2}", action, uri, error); }
export function unableToFindObject(path: string, objType: string) { return l10n.t("Unable to find {1} with path '{0}'", path, objType); }
export function deployScriptExists(scriptType: string) { return l10n.t("A {0} script already exists. The new script will not be included in build.", scriptType); }
export function cantAddCircularProjectReference(project: string) { return l10n.t("A reference to project '{0}' cannot be added. Adding this project as a reference would cause a circular dependency", project); }
export function unableToFindSqlCmdVariable(variableName: string) { return l10n.t("Unable to find SQLCMD variable '{0}'", variableName); }
export function unableToFindDatabaseReference(reference: string) { return l10n.t("Unable to find database reference {0}", reference); }
export function invalidGuid(guid: string) { return l10n.t("Specified GUID is invalid: {0}", guid); }
export function invalidTargetPlatform(targetPlatform: string, supportedTargetPlatforms: string[]) { return l10n.t("Invalid target platform: {0}. Supported target platforms: {1}", targetPlatform, supportedTargetPlatforms.toString()); }
export function errorReadingProject(section: string, path: string, error?: string) { return l10n.t("Error trying to read {0} of project '{1}'. {2}", section, path, error); }
export function errorAddingDatabaseReference(referenceName: string, error: string) { return l10n.t("Error adding database reference to {0}. Error: {1}", referenceName, error); }
export function errorNotSupportedInVsCode(actionDescription: string) { return l10n.t("Error: {0} is not currently supported in SQL Database Projects for VS Code.", actionDescription); }
export function sqlcmdVariableNameCannotContainWhitespace(name: string) { return l10n.t("SQLCMD variable name '{0}' cannot contain whitespace", name); }
export function sqlcmdVariableNameCannotContainIllegalChars(name: string) { return l10n.t("SQLCMD variable name '{0}' cannot contain any of the following characters: {1}", name, illegalSqlCmdChars.join(', ')); }

//#endregion

// Action types
export const deleteAction = l10n.t('Delete');
export const excludeAction = l10n.t('Exclude');

// Project tree object types
export const fileObject = l10n.t("file");
export const folderObject = l10n.t("folder");

//#region Project script types
export const folderFriendlyName = l10n.t("Folder");
export const scriptFriendlyName = l10n.t("Script");
export const tableFriendlyName = l10n.t("Table");
export const viewFriendlyName = l10n.t("View");
export const storedProcedureFriendlyName = l10n.t("Stored Procedure");
export const dataSourceFriendlyName = l10n.t("Data Source");
export const fileFormatFriendlyName = l10n.t("File Format");
export const externalStreamFriendlyName = l10n.t("External Stream");
export const externalStreamingJobFriendlyName = l10n.t("External Streaming Job");
export const preDeployScriptFriendlyName = l10n.t("Script.PreDeployment");
export const postDeployScriptFriendlyName = l10n.t("Script.PostDeployment");
export const publishProfileFriendlyName = l10n.t("Publish Profile");
export const tasksJsonFriendlyName = l10n.t("Tasks.json");

//#endregion

//#region Build
export const DotnetInstallationConfirmation: string = l10n.t("The .NET SDK cannot be located. Project build will not work. Please install .NET 8 SDK or higher or update the .NET SDK location in settings if already installed.");
export function NetCoreSupportedVersionInstallationConfirmation(installedVersion: string) { return l10n.t("Currently installed .NET SDK version is {0}, which is not supported. Project build will not work. Please install .NET 8 SDK or higher or update the .NET SDK supported version location in settings if already installed.", installedVersion); }
export const UpdateDotnetLocation: string = l10n.t("Update Location");
export const projectsOutputChannel = l10n.t("Database Projects");

//#endregion

// Prompt buttons
export const Install: string = l10n.t("Install");
export const DoNotAskAgain: string = l10n.t("Don't Ask Again");

//#region SqlProj file XML names
export const ItemGroup = 'ItemGroup';
export const Build = 'Build';
export const Folder = 'Folder';
export const Include = 'Include';
export const Remove = 'Remove';
export const Import = 'Import';
export const Project = 'Project';
export const Condition = 'Condition';
export const Target = 'Target';
export const Name = 'Name';
export const BeforeBuildTarget = 'BeforeBuild';
export const Delete = 'Delete';
export const Files = 'Files';
export const PackageReference = 'PackageReference';
export const Version = 'Version';
export const PrivateAssets = 'PrivateAssets';
export const SqlCmdVariable = 'SqlCmdVariable';
export const DefaultValue = 'DefaultValue';
export const Value = 'Value';
export const ArtifactReference = 'ArtifactReference';
export const SuppressMissingDependenciesErrors = 'SuppressMissingDependenciesErrors';
export const DatabaseVariableLiteralValue = 'DatabaseVariableLiteralValue';
export const DatabaseSqlCmdVariable = 'DatabaseSqlCmdVariable';
export const ServerSqlCmdVariable = 'ServerSqlCmdVariable';
export const DSP = 'DSP';
export const Properties = 'Properties';
export const RelativeOuterPath = '..';
export const ProjectReference = 'ProjectReference';
export const TargetConnectionString = 'TargetConnectionString';
export const PreDeploy = 'PreDeploy';
export const PostDeploy = 'PostDeploy';
export const None = 'None';
export const True = 'True';
export const False = 'False';
export const Private = 'Private';
export const ProjectGuid = 'ProjectGuid';
export const PropertyGroup = 'PropertyGroup';
export const Type = 'Type';
export const ExternalStreamingJob: string = 'ExternalStreamingJob';
export const Sdk: string = 'Sdk';
export const DatabaseSource = 'DatabaseSource';
export const VisualStudioVersion = 'VisualStudioVersion';
export const SSDTExists = 'SSDTExists';
export const OutputPath = 'OutputPath';
export const Configuration = 'Configuration';
export const Platform = 'Platform';
export const AnyCPU = 'AnyCPU';

export const BuildElements = l10n.t("Build Elements");
export const FolderElements = l10n.t("Folder Elements");
export const PreDeployElements = l10n.t("PreDeploy Elements");
export const PostDeployElements = l10n.t("PostDeploy Elements");
export const NoneElements = l10n.t("None Elements");
export const ImportElements = l10n.t("Import Elements");
export const ProjectReferenceNameElement = l10n.t("Project reference name element");
export const ProjectReferenceElement = l10n.t("Project reference");
export const DacpacReferenceElement = l10n.t("Dacpac reference");
export const PublishProfileElements = l10n.t("Publish profile elements");

//#endregion

export function defaultOutputPath(configuration: string) { return path.join('.', 'bin', configuration); }

/**
 * Path separator to use within SqlProj file for `Include`, `Exclude`, etc. attributes.
 * This matches Windows path separator, as expected by SSDT.
 */
export const SqlProjPathSeparator = '\\';

// Profile XML names
export const targetDatabaseName = 'TargetDatabaseName';
export const targetConnectionString = 'TargetConnectionString';

//#region SQL connection string components
export const initialCatalogSetting = 'Initial Catalog';
export const dataSourceSetting = 'Data Source';
export const integratedSecuritySetting = 'Integrated Security';
export const authenticationSetting = 'Authentication';
export const activeDirectoryInteractive = 'active directory interactive';
export const userIdSetting = 'User ID';
export const passwordSetting = 'Password';
export const encryptSetting = 'Encrypt';
export const trustServerCertificateSetting = 'Trust Server Certificate';
export const hostnameInCertificateSetting = 'Host Name in Certificate';

export const azureAddAccount = l10n.t("Add an Account...");
//#endregion

//#region Tree item types
export enum DatabaseProjectItemType {
	project = 'databaseProject.itemType.project',
	legacyProject = 'databaseProject.itemType.legacyProject',
	folder = 'databaseProject.itemType.folder',
	file = 'databaseProject.itemType.file',
	externalStreamingJob = 'databaseProject.itemType.file.externalStreamingJob',
	table = 'databaseProject.itemType.file.table',
	referencesRoot = 'databaseProject.itemType.referencesRoot',
	reference = 'databaseProject.itemType.reference',
	sqlProjectReference = 'databaseProject.itemType.reference.sqlProject',
	dataSourceRoot = 'databaseProject.itemType.dataSourceRoot',
	sqlcmdVariablesRoot = 'databaseProject.itemType.sqlcmdVariablesRoot',
	sqlcmdVariable = 'databaseProject.itemType.sqlcmdVariable',
	preDeploymentScript = 'databaseProject.itemType.file.preDeploymentScript',
	postDeploymentScript = 'databaseProject.itemType.file.postDeployScript',
	noneFile = 'databaseProject.itemType.file.noneFile',
	sqlObjectScript = 'databaseProject.itemType.file.sqlObjectScript',
	publishProfile = 'databaseProject.itemType.file.publishProfile'
}

//#endregion

//#region AutoRest
export const autorestPostDeploymentScriptName = 'PostDeploymentScript.sql';
export const nodeButNotAutorestFound = l10n.t("Autorest tool not found in system path, but found Node.js.  Prompting user for how to proceed.  Execute 'npm install autorest -g' to install permanently and avoid this message.");
export const nodeNotFound = l10n.t("Neither Autorest nor Node.js (npx) found in system path.  Please install Node.js for Autorest generation to work.");
export const nodeButNotAutorestFoundPrompt = l10n.t("Autorest is not installed. To proceed, choose whether to run Autorest from a temporary location via 'npx' or install Autorest globally then run.");
export const userSelectionInstallGlobally = l10n.t("User selected to install autorest gloablly.  Installing now...");
export const userSelectionRunNpx = l10n.t("User selected to run via npx.");
export const userSelectionCancelled = l10n.t("User has cancelled selection for how to run autorest.");
export const installGlobally = l10n.t("Install globally");
export const runViaNpx = l10n.t("Run via npx");

export const selectSpecFile = l10n.t("Select OpenAPI/Swagger spec file");
export function generatingProjectFailed(errorMessage: string) { return l10n.t("Generating project via AutoRest failed.  Check output pane for more details. Error: {0}", errorMessage); }
export const noSqlFilesGenerated = l10n.t("No .sql files were generated by Autorest. Please confirm that your spec contains model definitions, or check the output log for details.");
export function multipleMostDeploymentScripts(count: number) { return l10n.t("Unexpected number of {0} files: {1}", autorestPostDeploymentScriptName, count); }
export const specSelectionText = l10n.t("OpenAPI/Swagger spec");
export const autorestProjectName = l10n.t("New SQL project name");
export function generatingProjectFromAutorest(specName: string) { return l10n.t("Generating new SQL project from {0}...  Check output window for details.", specName); }
//#endregion

// System dbs
export const systemDbs = ['master', 'msdb', 'tempdb', 'model'];

// SQL queries
export const sameDatabaseExampleUsage = 'SELECT * FROM [Schema1].[Table1]';
export function differentDbSameServerExampleUsage(db: string) { return `SELECT * FROM [${db}].[Schema1].[Table1]`; }
export function differentDbDifferentServerExampleUsage(server: string, db: string) { return `SELECT * FROM [${server}].[${db}].[Schema1].[Table1]`; }
//#endregion

//#region Target platforms
export const targetPlatformToVersion: Map<string, string> = new Map<string, string>([
	// Note: the values here must match values from Microsoft.Data.Tools.Schema.SchemaModel.SqlPlatformNames
	[SqlTargetPlatform.sqlServer2012, '110'],
	[SqlTargetPlatform.sqlServer2014, '120'],
	[SqlTargetPlatform.sqlServer2016, '130'],
	[SqlTargetPlatform.sqlServer2017, '140'],
	[SqlTargetPlatform.sqlServer2019, '150'],
	[SqlTargetPlatform.sqlServer2022, '160'],
	[SqlTargetPlatform.sqlServer2025, '170'],
	[SqlTargetPlatform.sqlAzure, 'AzureV12'],
	[SqlTargetPlatform.sqlDW, 'Dw'],
	[SqlTargetPlatform.sqlDwServerless, 'Serverless'],
	[SqlTargetPlatform.sqlDwUnified, 'DwUnified'],
	[SqlTargetPlatform.sqlDbFabric, 'DbFabric']
]);

export const onPremServerVersionToTargetPlatform: Map<number, SqlTargetPlatform> = new Map<number, SqlTargetPlatform>([
	[11, SqlTargetPlatform.sqlServer2012],
	[12, SqlTargetPlatform.sqlServer2014],
	[13, SqlTargetPlatform.sqlServer2016],
	[14, SqlTargetPlatform.sqlServer2017],
	[15, SqlTargetPlatform.sqlServer2019],
	[16, SqlTargetPlatform.sqlServer2022],
	[17, SqlTargetPlatform.sqlServer2025]
]);

// DW is special since the system dacpac folder has a different name from the target platform
export const AzureDwFolder = 'AzureDw';

export const defaultTargetPlatform = SqlTargetPlatform.sqlServer2025;
export const defaultDSP = targetPlatformToVersion.get(defaultTargetPlatform)!;

/**
 * Returns the name of the target platform of the version of sql
 * @param version version of sql
 * @returns target platform name
 */
export function getTargetPlatformFromVersion(version: string): string {
	return Array.from(targetPlatformToVersion.keys()).filter(k => targetPlatformToVersion.get(k) === version)[0];
}

//#endregion

export enum PublishTargetType {
	existingServer = 'existingServer',
	docker = 'docker',
	newAzureServer = 'newAzureServer'
}

//#region Configuration keys
export const CollapseProjectNodesKey = 'collapseProjectNodes';
export const microsoftBuildSqlVersionKey = 'microsoftBuildSqlVersion';
export const enablePreviewFeaturesKey = 'enablePreviewFeatures';
export const mssqlConfigSectionKey = 'mssql';
export const mssqlEnableExperimentalFeaturesKey = 'enableExperimentalFeatures';

//#endregion

//#region httpClient
export const downloadError = l10n.t("Download error");
export const downloadProgress = l10n.t("Download progress");
export const downloading = l10n.t("Downloading");

//#endregion

//#region buildHelper
export function downloadingNuget(nuget: string) { return l10n.t("Downloading {0} nuget to get build DLLs ", nuget); }
export function downloadingFromTo(from: string, to: string) { return l10n.t("Downloading from {0} to {1}", from, to); }
export function extractingDacFxDlls(location: string) { return l10n.t("Extracting DacFx build DLLs to {0}", location); }
export function errorDownloading(url: string, error: string) { return l10n.t("Error downloading {0}. Error: {1}", url, error); }
export function errorExtracting(path: string, error: string) { return l10n.t("Error extracting files from {0}. Error: {1}", path, error); }

//#endregion

//#region move
export const onlyMoveFilesFoldersSupported = l10n.t("Only moving files and folders are supported");
export const movingFilesBetweenProjectsNotSupported = l10n.t("Moving files between projects is not supported");
export function errorMovingFile(source: string, destination: string, error: string) { return l10n.t("Error when moving file from {0} to {1}. Error: {2}", source, destination, error); }
export function moveConfirmationPrompt(source: string, destination: string) { return l10n.t("Are you sure you want to move {0} to {1}?", source, destination); }
export const move = l10n.t("Move");
export function errorRenamingFile(source: string, destination: string, error: string) { return l10n.t("Error when renaming file from {0} to {1}. Error: {2}", source, destination, error); }
export const unhandledMoveNode = l10n.t("Unhandled node type for move");

//#endregion
