/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import { SqlTargetPlatform } from "../sqldbproj";

//#region file extensions
export const dataSourcesFileName = "datasources.json";
export const sqlprojExtension = ".sqlproj";
export const sqlFileExtension = ".sql";
export const publishProfileExtension = ".publish.xml";

//#endregion

//#region Placeholder values
export const schemaCompareExtensionId = "microsoft.schema-compare";
export const master = "master";
export const msdb = "msdb";
export const MicrosoftDatatoolsSchemaSqlSql = "Microsoft.Data.Tools.Schema.Sql.Sql";
export const databaseSchemaProvider = "DatabaseSchemaProvider";
export const sqlProjectSdk = "Microsoft.Build.Sql";
export const sdkStyleProjectStyleName = "SdkStyle";
export const legacyStyleProjectStyleName = "LegacyStyle";
export const problemMatcher = "$sqlproj-problem-matcher";
export const sqlProjTaskType = "sqlproj-build";
export const dotnet = "dotnet";
export const build = "build";
export const restore = "restore";
export const runCodeAnalysisParam = "/p:RunSqlCodeAnalysis=true";

//#endregion

//#region Project Provider
export const emptySqlDatabaseProjectTypeId = "EmptySqlDbProj";

export const edgeSqlDatabaseProjectTypeId = "SqlDbEdgeProj";

export const emptySqlDatabaseSdkProjectTypeId = "EmptySqlDbSdkProj";

export const emptyAzureDbSqlDatabaseProjectTypeId = "EmptyAzureSqlDbProj";

//#endregion

//#region commands
export const revealFileInOsCommand = "revealFileInOS";
export const schemaCompareStartCommand = "schemaCompare.start";
export const schemaCompareRunComparisonCommand = "schemaCompare.runComparison";
export const mssqlSchemaCompareCommand = "mssql.schemaCompare";
export const mssqlPublishProjectCommand = "mssql.publishDatabaseProject";
export const mssqlConfigureCodeAnalysisSettingsCommand = "mssql.configureCodeAnalysisSettings";
export const vscodeOpenCommand = "vscode.open";
export const refreshDataWorkspaceCommand = "dataworkspace.refresh";

//#endregion

//#region UI Strings

export const sdkLearnMoreUrl = "https://aka.ms/sqlprojsdk";
export const documentationUrl = "https://aka.ms/sqlprojects";
export const azureDevOpsLink =
    "https://docs.microsoft.com/azure/azure-sql/database/local-dev-experience-overview?view=azuresql";

export const nullProjectGuid = "{00000000-0000-0000-0000-000000000000}";

//#endregion

export const illegalSqlCmdChars = ["$", "@", "#", '"', "'", "-"];
export const reservedProjectFolders = ["Properties", "SQLCMD Variables", "Database References"];

export const otherServer = "OtherServer";
export const otherSeverVariable = "OtherServer";

//#region Default folder paths for item types
// Maps item types to their default folder locations when created at project root
// These follow SSDT conventions for folder structure
export const securityFolderName = "Security";
export const functionsFolderName = "Functions";
export const tablesFolderName = "Tables";
export const viewsFolderName = "Views";
export const storedProceduresFolderName = "StoredProcedures";
export const triggersFolderName = "Triggers";
export const databaseTriggersFolderName = "DatabaseTriggers";
export const sequencesFolderName = "Sequences";
export const defaultSchemaName = "dbo";
//#endregion

//#region Extension settings
export const autoCreateFoldersSetting = "sqlDatabaseProjects.autoCreateFolders";
//#endregion

//#region SqlProj file XML names
export const ItemGroup = "ItemGroup";
export const Build = "Build";
export const Folder = "Folder";
export const Include = "Include";
export const Remove = "Remove";
export const Import = "Import";
export const Project = "Project";
export const Condition = "Condition";
export const Target = "Target";
export const Name = "Name";
export const BeforeBuildTarget = "BeforeBuild";
export const Delete = "Delete";
export const Files = "Files";
export const PackageReference = "PackageReference";
export const Version = "Version";
export const PrivateAssets = "PrivateAssets";
export const SqlCmdVariable = "SqlCmdVariable";
export const DefaultValue = "DefaultValue";
export const Value = "Value";
export const ArtifactReference = "ArtifactReference";
export const SuppressMissingDependenciesErrors = "SuppressMissingDependenciesErrors";
export const DatabaseVariableLiteralValue = "DatabaseVariableLiteralValue";
export const DatabaseSqlCmdVariable = "DatabaseSqlCmdVariable";
export const ServerSqlCmdVariable = "ServerSqlCmdVariable";
export const DSP = "DSP";
export const Properties = "Properties";
export const RelativeOuterPath = "..";
export const ProjectReference = "ProjectReference";
export const TargetConnectionString = "TargetConnectionString";
export const PreDeploy = "PreDeploy";
export const PostDeploy = "PostDeploy";
export const None = "None";
export const True = "True";
export const False = "False";
export const Private = "Private";
export const ProjectGuid = "ProjectGuid";
export const PropertyGroup = "PropertyGroup";
export const Type = "Type";
export const ExternalStreamingJob = "ExternalStreamingJob";
export const Sdk = "Sdk";
export const DatabaseSource = "DatabaseSource";
export const VisualStudioVersion = "VisualStudioVersion";
export const SSDTExists = "SSDTExists";
export const OutputPath = "OutputPath";
export const Configuration = "Configuration";
export const Platform = "Platform";
export const AnyCPU = "AnyCPU";

//#endregion

export function defaultOutputPath(configuration: string) {
    return path.join(".", "bin", configuration);
}

/**
 * Path separator to use within SqlProj file for `Include`, `Exclude`, etc. attributes.
 * This matches Windows path separator, as expected by SSDT.
 */
export const SqlProjPathSeparator = "\\";

// Profile XML names
export const targetDatabaseName = "TargetDatabaseName";
export const targetConnectionString = "TargetConnectionString";

//#region SQL connection string components
export const initialCatalogSetting = "Initial Catalog";
export const dataSourceSetting = "Data Source";
export const integratedSecuritySetting = "Integrated Security";
export const authenticationSetting = "Authentication";
export const activeDirectoryInteractive = "active directory interactive";
export const userIdSetting = "User ID";
export const passwordSetting = "Password";
export const encryptSetting = "Encrypt";
export const trustServerCertificateSetting = "Trust Server Certificate";
export const hostnameInCertificateSetting = "Host Name in Certificate";

//#endregion

//#region Tree item types
export enum DatabaseProjectItemType {
    project = "databaseProject.itemType.project",
    legacyProject = "databaseProject.itemType.legacyProject",
    folder = "databaseProject.itemType.folder",
    file = "databaseProject.itemType.file",
    externalStreamingJob = "databaseProject.itemType.file.externalStreamingJob",
    referencesRoot = "databaseProject.itemType.referencesRoot",
    reference = "databaseProject.itemType.reference",
    sqlProjectReference = "databaseProject.itemType.reference.sqlProject",
    dataSourceRoot = "databaseProject.itemType.dataSourceRoot",
    sqlcmdVariablesRoot = "databaseProject.itemType.sqlcmdVariablesRoot",
    sqlcmdVariable = "databaseProject.itemType.sqlcmdVariable",
    preDeploymentScript = "databaseProject.itemType.file.preDeploymentScript",
    postDeploymentScript = "databaseProject.itemType.file.postDeployScript",
    noneFile = "databaseProject.itemType.file.noneFile",
    sqlObjectScript = "databaseProject.itemType.file.sqlObjectScript",
    publishProfile = "databaseProject.itemType.file.publishProfile",
}

//#endregion

// System dbs
export const systemDbs = ["master", "msdb", "tempdb", "model"];

// SQL queries
export const sameDatabaseExampleUsage = "SELECT * FROM [Schema1].[Table1]";
export function differentDbSameServerExampleUsage(db: string) {
    return `SELECT * FROM [${db}].[Schema1].[Table1]`;
}
export function differentDbDifferentServerExampleUsage(server: string, db: string) {
    return `SELECT * FROM [${server}].[${db}].[Schema1].[Table1]`;
}
//#region Target platforms
export const targetPlatformToVersion: Map<string, string> = new Map<string, string>([
    // Note: the values here must match values from Microsoft.Data.Tools.Schema.SchemaModel.SqlPlatformNames
    [SqlTargetPlatform.sqlServer2012, "110"],
    [SqlTargetPlatform.sqlServer2014, "120"],
    [SqlTargetPlatform.sqlServer2016, "130"],
    [SqlTargetPlatform.sqlServer2017, "140"],
    [SqlTargetPlatform.sqlServer2019, "150"],
    [SqlTargetPlatform.sqlServer2022, "160"],
    [SqlTargetPlatform.sqlServer2025, "170"],
    [SqlTargetPlatform.sqlAzure, "AzureV12"],
    [SqlTargetPlatform.sqlDW, "Dw"],
    [SqlTargetPlatform.sqlDwServerless, "Serverless"],
    [SqlTargetPlatform.sqlDwUnified, "DwUnified"],
    [SqlTargetPlatform.sqlDbFabric, "DbFabric"],
]);

export const onPremServerVersionToTargetPlatform: Map<number, SqlTargetPlatform> = new Map<
    number,
    SqlTargetPlatform
>([
    [11, SqlTargetPlatform.sqlServer2012],
    [12, SqlTargetPlatform.sqlServer2014],
    [13, SqlTargetPlatform.sqlServer2016],
    [14, SqlTargetPlatform.sqlServer2017],
    [15, SqlTargetPlatform.sqlServer2019],
    [16, SqlTargetPlatform.sqlServer2022],
    [17, SqlTargetPlatform.sqlServer2025],
]);

// DW is special since the system dacpac folder has a different name from the target platform
export const AzureDwFolder = "AzureDw";

export const defaultTargetPlatform = SqlTargetPlatform.sqlServer2025;
export const defaultDSP = targetPlatformToVersion.get(defaultTargetPlatform)!;

/**
 * Returns the name of the target platform of the version of sql
 * @param version version of sql
 * @returns target platform name
 */
export function getTargetPlatformFromVersion(version: string): string {
    return Array.from(targetPlatformToVersion.keys()).filter(
        (k) => targetPlatformToVersion.get(k) === version,
    )[0];
}

//#endregion

//#region Configuration keys
export const CollapseProjectNodesKey = "collapseProjectNodes";
export const microsoftBuildSqlVersionKey = "microsoftBuildSqlVersion";
export const enablePreviewFeaturesKey = "enablePreviewFeatures";
export const mssqlConfigSectionKey = "mssql";
export const mssqlEnableExperimentalFeaturesKey = "enableExperimentalFeatures";

//#endregion

//#region tasks.json

export const netCoreBuildArg = "/p:NetCoreBuild=true";
export const systemDacpacsLocationArgPrefix = "/p:SystemDacpacsLocation=";
export const netCoreTargetsPathArgPrefix = "/p:NETCoreTargetsPath=";
export const tasksJsonVersion = "2.0.0";
export const vscodeFolderName = ".vscode";
export const tasksJsonFileName = "tasks.json";
export const processTaskType = "process";
export const sqlprojBuildTaskLabelPrefix = "sqlproj: Build";
export function getSqlProjectBuildTaskLabel(projectName: string): string {
    return `${sqlprojBuildTaskLabelPrefix} ${projectName}`;
}

//#endregion
