import { RequestType } from 'vscode-languageclient';
import * as mssql from 'vscode-mssql';

//#region Project-level functions

export namespace CreateSqlProjectRequest {
	export const type = new RequestType<mssql.CreateSqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/createProject');
}

export namespace OpenSqlProjectRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/openProject');
}

export namespace CloseSqlProjectRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/closeProject');
}

export namespace GetCrossPlatformCompatibilityRequest {
	export const type
		= new RequestType<mssql.SqlProjectParams, mssql.GetCrossPlatformCompatibilityResult, void, void>('sqlProjects/getCrossPlatformCompatibility');
}

export namespace UpdateProjectForCrossPlatformRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.ResultStatus, void, void>('sqlProjects/updateProjectForCrossPlatform');
}

//#endregion

//#region File/folder functions

//#region SQL object script functions

export namespace AddSqlObjectScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/addSqlObjectScript');
}

export namespace DeleteSqlObjectScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/deleteSqlObjectScript');
}

export namespace ExcludeSqlObjectScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/excludeSqlObjectScript');
}

export namespace MoveSqlObjectScriptRequest {
	export const type = new RequestType<mssql.MoveItemParams, mssql.ResultStatus, void, void>('sqlProjects/moveSqlObjectScript');
}

export namespace GetDatabaseReferencesRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.GetDatabaseReferencesResult, void, void>('sqlProjects/getDatabaseReferences');
}

export namespace GetFoldersRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.GetFoldersResult, void, void>('sqlProjects/getFolders');
}

export namespace GetPostDeploymentScriptsRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.GetScriptsResult, void, void>('sqlProjects/getPostDeploymentScripts');
}

export namespace GetPreDeploymentScriptsRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.GetScriptsResult, void, void>('sqlProjects/getPreDeploymentScripts');
}

export namespace GetSqlCmdVariablesRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.GetSqlCmdVariablesResult, void, void>('sqlProjects/getSqlCmdVariables');
}

export namespace GetSqlObjectScriptsRequest {
	export const type = new RequestType<mssql.SqlProjectParams, mssql.GetScriptsResult, void, void>('sqlProjects/getSqlObjectScripts');
}

//#endregion

//#region Folder functions

export namespace AddFolderRequest {
	export const type = new RequestType<mssql.FolderParams, mssql.ResultStatus, void, void>('sqlProjects/addFolder');
}

export namespace DeleteFolderRequest {
	export const type = new RequestType<mssql.FolderParams, mssql.ResultStatus, void, void>('sqlProjects/deleteFolder');
}

//#endregion

//#region Pre/Post-deployment script functions

export namespace AddPostDeploymentScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/addPostDeploymentScript');
}

export namespace AddPreDeploymentScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/addPreDeploymentScript');
}

export namespace DeletePostDeploymentScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/deletePostDeploymentScript');
}

export namespace DeletePreDeploymentScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/deletePreDeploymentScript');
}

export namespace ExcludePostDeploymentScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/excludePostDeploymentScript');
}

export namespace ExcludePreDeploymentScriptRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlProjects/excludePreDeploymentScript');
}

export namespace MovePostDeploymentScriptRequest {
	export const type = new RequestType<mssql.MoveItemParams, mssql.ResultStatus, void, void>('sqlProjects/movePostDeploymentScript');
}

export namespace MovePreDeploymentScriptRequest {
	export const type = new RequestType<mssql.MoveItemParams, mssql.ResultStatus, void, void>('sqlProjects/movePreDeploymentScript');
}

//#endregion

//#endregion

//#region SQLCMD variable functions

export namespace AddSqlCmdVariableRequest {
	export const type = new RequestType<mssql.AddSqlCmdVariableParams, mssql.ResultStatus, void, void>('sqlProjects/addSqlCmdVariable');
}

export namespace DeleteSqlCmdVariableRequest {
	export const type = new RequestType<mssql.DeleteSqlCmdVariableParams, mssql.ResultStatus, void, void>('sqlProjects/deleteSqlCmdVariable');
}

export namespace UpdateSqlCmdVariableRequest {
	export const type = new RequestType<mssql.AddSqlCmdVariableParams, mssql.ResultStatus, void, void>('sqlProjects/updateSqlCmdVariable');
}

//#endregion

//#region Database reference functions

export namespace AddDacpacReferenceRequest {
	export const type = new RequestType<mssql.AddDacpacReferenceParams, mssql.ResultStatus, void, void>('sqlprojects/addDacpacReference');
}

export namespace AddSqlProjectReferenceRequest {
	export const type = new RequestType<mssql.AddSqlProjectReferenceParams, mssql.ResultStatus, void, void>('sqlprojects/addSqlProjectReference');
}

export namespace AddSystemDatabaseReferenceRequest {
	export const type = new RequestType<mssql.AddSystemDatabaseReferenceParams, mssql.ResultStatus, void, void>('sqlprojects/addSystemDatabaseReference');
}

export namespace DeleteDatabaseReferenceRequest {
	export const type = new RequestType<mssql.SqlProjectScriptParams, mssql.ResultStatus, void, void>('sqlprojects/deleteDatabaseReference');
}

//#endregion
