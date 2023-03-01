import { RequestType } from 'vscode-languageclient';
import * as mssql from 'vscode-mssql';

//#region Functions

//#region Project-level functions

export namespace CreateSqlProjectRequest {
	export const type = new RequestType<CreateSqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/createProject');
}

export namespace OpenSqlProjectRequest {
	export const type = new RequestType<SqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/openProject');
}

export namespace CloseSqlProjectRequest {
	export const type = new RequestType<SqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/closeProject');
}

export namespace GetCrossPlatformCompatibilityRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetCrossPlatformCompatibilityResult, void, void>('sqlProjects/getCrossPlatformCompatibility');
}

export namespace UpdateProjectForCrossPlatformRequest {
	export const type = new RequestType<SqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/updateProjectForCrossPlatform');
}

//#endregion

//#region File/folder functions

//#region SQL object script functions

export namespace AddSqlObjectScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/addSqlObjectScript');
}

export namespace DeleteSqlObjectScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/deleteSqlObjectScript');
}

export namespace ExcludeSqlObjectScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/excludeSqlObjectScript');
}

export namespace MoveSqlObjectScriptRequest {
	export const type = new RequestType<MoveItemParams, mssql.ResultStatus, void, void>('sqlProjects/moveSqlObjectScript');
}

export namespace GetDatabaseReferencesRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetDatabaseReferencesResult, void, void>('sqlProjects/getDatabaseReferences');
}

export namespace GetFoldersRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetFoldersResult, void, void>('sqlProjects/getFolders');
}

export namespace GetPostDeploymentScriptsRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetScriptsResult, void, void>('sqlProjects/getPostDeploymentScripts');
}

export namespace GetPreDeploymentScriptsRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetScriptsResult, void, void>('sqlProjects/getPreDeploymentScripts');
}

export namespace GetSqlCmdVariablesRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetSqlCmdVariablesResult, void, void>('sqlProjects/getSqlCmdVariables');
}

export namespace GetSqlObjectScriptsRequest {
	export const type = new RequestType<SqlProjectParams, mssql.GetScriptsResult, void, void>('sqlProjects/getSqlObjectScripts');
}

//#endregion

//#region Folder functions

export namespace AddFolderRequest {
	export const type = new RequestType<FolderParams, mssql.ResultStatus, void, void>('sqlProjects/addFolder');
}

export namespace DeleteFolderRequest {
	export const type = new RequestType<FolderParams, mssql.ResultStatus, void, void>('sqlProjects/deleteFolder');
}

//#endregion

//#region Pre/Post-deployment script functions

export namespace AddPostDeploymentScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/addPostDeploymentScript');
}

export namespace AddPreDeploymentScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/addPreDeploymentScript');
}

export namespace DeletePostDeploymentScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/deletePostDeploymentScript');
}

export namespace DeletePreDeploymentScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/deletePreDeploymentScript');
}

export namespace ExcludePostDeploymentScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/excludePostDeploymentScript');
}

export namespace ExcludePreDeploymentScriptRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/excludePreDeploymentScript');
}

export namespace MovePostDeploymentScriptRequest {
	export const type = new RequestType<MoveItemParams, mssql.ResultStatus, void, void>('sqlProjects/movePostDeploymentScript');
}

export namespace MovePreDeploymentScriptRequest {
	export const type = new RequestType<MoveItemParams, mssql.ResultStatus, void, void>('sqlProjects/movePreDeploymentScript');
}

//#endregion

//#endregion

//#region SQLCMD variable functions

export namespace AddSqlCmdVariableRequest {
	export const type = new RequestType<AddSqlCmdVariableParams, mssql.ResultStatus, void, void>('sqlProjects/addSqlCmdVariable');
}

export namespace DeleteSqlCmdVariableRequest {
	export const type = new RequestType<DeleteSqlCmdVariableParams, mssql.ResultStatus, void, void>('sqlProjects/deleteSqlCmdVariable');
}

export namespace UpdateSqlCmdVariableRequest {
	export const type = new RequestType<AddSqlCmdVariableParams, mssql.ResultStatus, void, void>('sqlProjects/updateSqlCmdVariable');
}

//#endregion

//#region Database reference functions

export namespace AddDacpacReferenceRequest {
	/**
	 *
	 */
	export const type = new RequestType<AddDacpacReferenceParams, mssql.ResultStatus, void, void>('sqlprojects/addDacpacReference');
}

export namespace AddSqlProjectReferenceRequest {
	export const type = new RequestType<AddSqlProjectReferenceParams, mssql.ResultStatus, void, void>('sqlprojects/addSqlProjectReference');
}

export namespace AddSystemDatabaseReferenceRequest {
	export const type = new RequestType<AddSystemDatabaseReferenceParams, mssql.ResultStatus, void, void>('sqlprojects/addSystemDatabaseReference');
}

export namespace DeleteDatabaseReferenceRequest {
	export const type = new RequestType<SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlprojects/deleteDatabaseReference');
}

//#endregion

//#endregion

//#region Parameters

export interface SqlProjectParams {
	/**
	 * Absolute path of the project, including .sqlproj
	 */
	projectUri: string;
}

export interface SqlProjectScriptParams extends SqlProjectParams {
	/**
	 * Path of the script, including .sql, relative to the .sqlproj
	 */
	path: string;
}

export interface AddDacpacReferenceParams extends AddUserDatabaseReferenceParams {
	/**
	 * Path to the .dacpac file
	 */
	dacpacPath: string;
}

export interface AddDatabaseReferenceParams extends SqlProjectParams {
	/**
	 * Whether to suppress missing dependencies
	 */
	suppressMissingDependencies: boolean;
	/**
	 * Literal name used to reference another database in the same server, if not using SQLCMD variables
	 */
	databaseLiteral?: string;
}

export interface AddSqlProjectReferenceParams extends AddUserDatabaseReferenceParams {
	/**
	 * Path to the referenced .sqlproj file
	 */
	projectPath: string;
	/**
	 * GUID for the referenced SQL project
	 */
	projectGuid: string;
}

export interface AddSystemDatabaseReferenceParams extends AddDatabaseReferenceParams {
	/**
	 * Type of system database
	 */
	systemDatabase: mssql.SystemDatabase;
}

export interface AddUserDatabaseReferenceParams extends AddDatabaseReferenceParams {
	/**
	 * SQLCMD variable name for specifying the other database this reference is to, if different from that of the current project
	 */
	databaseVariable?: string;
	/**
	 * SQLCMD variable name for specifying the other server this reference is to, if different from that of the current project.
	 * If this is set, DatabaseVariable must also be set.
	 */
	serverVariable?: string;
}

export interface DeleteDatabaseReferenceParams extends SqlProjectParams {
	/**
	 * Name of the reference to be deleted.  Name of the System DB, path of the sqlproj, or path of the dacpac
	 */
	name: string;
}

export interface FolderParams extends SqlProjectParams {
	/**
	 * Path of the folder, typically relative to the .sqlproj file
	 */
	path: string;
}

export interface CreateSqlProjectParams extends SqlProjectParams {
	/**
	 * Type of SQL Project: SDK-style or Legacy
	 */
	sqlProjectType: mssql.ProjectType;
	/**
	 * Database schema provider for the project, in the format
	 * "Microsoft.Data.Tools.Schema.Sql.SqlXYZDatabaseSchemaProvider".
	 * Case sensitive.
	 */
	databaseSchemaProvider?: string;
	/**
	 * Version of the Microsoft.Build.Sql SDK for the project, if overriding the default
	 */
	buildSdkVersion?: string;
}

export interface AddSqlCmdVariableParams extends SqlProjectParams {
	/**
	 * Name of the SQLCMD variable
	 */
	name: string;
	/**
	 * Default value of the SQLCMD variable
	 */
	defaultValue: string;
	/**
	 * Value of the SQLCMD variable, with or without the $()
	 */
	value: string;
}

export interface DeleteSqlCmdVariableParams extends SqlProjectParams {
	/**
	 * Name of the SQLCMD variable to be deleted
	 */
	name?: string;
}

export interface MoveItemParams extends SqlProjectScriptParams {
	/**
	 * Destination path of the file or folder, relative to the .sqlproj
	 */
	destinationPath: string;
}

//#endregion