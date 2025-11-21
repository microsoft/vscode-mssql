/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as mssql from "vscode-mssql";
import SqlToolsServiceClient from "../languageservice/serviceclient";
import * as contracts from "../models/contracts/sqlProjects/sqlProjectsContracts";

export class SqlProjectsService implements mssql.ISqlProjectsService {
  constructor(private _client: SqlToolsServiceClient) {}

  /**
   * Add a dacpac reference to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param dacpacPath Path to the .dacpac file
   * @param suppressMissingDependencies Whether to suppress missing dependencies
   * @param databaseVariable SQLCMD variable name for specifying the other database this reference is to, if different from that of the current project
   * @param serverVariable SQLCMD variable name for specifying the other server this reference is to, if different from that of the current project.
   * If this is set, DatabaseVariable must also be set.
   * @param databaseLiteral Literal name used to reference another database in the same server, if not using SQLCMD variables
   */
  public async addDacpacReference(
    projectUri: string,
    dacpacPath: string,
    suppressMissingDependencies: boolean,
    databaseVariable?: string,
    serverVariable?: string,
    databaseLiteral?: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.AddDacpacReferenceParams = {
      projectUri: projectUri,
      dacpacPath: dacpacPath,
      suppressMissingDependencies: suppressMissingDependencies,
      databaseVariable: databaseVariable,
      serverVariable: serverVariable,
      databaseLiteral: databaseLiteral,
    };
    return this._client.sendRequest(
      contracts.AddDacpacReferenceRequest.type,
      params,
    );
  }

  /**
   * Add a SQL Project reference to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param projectPath Path to the referenced .sqlproj file
   * @param projectGuid GUID for the referenced SQL project
   * @param suppressMissingDependencies Whether to suppress missing dependencies
   * @param databaseVariable SQLCMD variable name for specifying the other database this reference is to, if different from that of the current project
   * @param serverVariable SQLCMD variable name for specifying the other server this reference is to, if different from that of the current project.
   * If this is set, DatabaseVariable must also be set.
   * @param databaseLiteral Literal name used to reference another database in the same server, if not using SQLCMD variables
   */
  public async addSqlProjectReference(
    projectUri: string,
    projectPath: string,
    projectGuid: string,
    suppressMissingDependencies: boolean,
    databaseVariable?: string,
    serverVariable?: string,
    databaseLiteral?: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.AddSqlProjectReferenceParams = {
      projectUri: projectUri,
      projectPath: projectPath,
      projectGuid: projectGuid,
      suppressMissingDependencies: suppressMissingDependencies,
      databaseVariable: databaseVariable,
      serverVariable: serverVariable,
      databaseLiteral: databaseLiteral,
    };
    return this._client.sendRequest(
      contracts.AddSqlProjectReferenceRequest.type,
      params,
    );
  }

  /**
   * Add a system database reference to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param systemDatabase Type of system database
   * @param suppressMissingDependencies Whether to suppress missing dependencies
   * @param referencetype Type of reference - ArtifactReference or PackageReference
   * @param databaseLiteral Literal name used to reference another database in the same server, if not using SQLCMD variables
   */
  public async addSystemDatabaseReference(
    projectUri: string,
    systemDatabase: mssql.SystemDatabase,
    suppressMissingDependencies: boolean,
    systemDbReferenceType: mssql.SystemDbReferenceType,
    databaseLiteral?: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.AddSystemDatabaseReferenceParams = {
      projectUri: projectUri,
      systemDatabase: systemDatabase,
      suppressMissingDependencies: suppressMissingDependencies,
      referenceType: systemDbReferenceType,
      databaseLiteral: databaseLiteral,
    };
    return this._client.sendRequest(
      contracts.AddSystemDatabaseReferenceRequest.type,
      params,
    );
  }

  /**
   * Add a nuget package database reference to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param packageName Name of the referenced nuget package
   * @param packageVersion Version of the referenced nuget package
   * @param suppressMissingDependencies Whether to suppress missing dependencies
   * @param databaseVariable SQLCMD variable name for specifying the other database this reference is to, if different from that of the current project
   * @param serverVariable SQLCMD variable name for specifying the other server this reference is to, if different from that of the current project.
   * If this is set, DatabaseVariable must also be set.
   * @param databaseLiteral Literal name used to reference another database in the same server, if not using SQLCMD variables
   */
  public async addNugetPackageReference(
    projectUri: string,
    packageName: string,
    packageVersion: string,
    suppressMissingDependencies: boolean,
    databaseVariable?: string,
    serverVariable?: string,
    databaseLiteral?: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.AddNugetPackageReferenceParams = {
      projectUri: projectUri,
      packageName: packageName,
      packageVersion: packageVersion,
      suppressMissingDependencies: suppressMissingDependencies,
      databaseVariable: databaseVariable,
      serverVariable: serverVariable,
      databaseLiteral: databaseLiteral,
    };

    return this._client.sendRequest(
      contracts.AddNugetPackageReferenceRequest.type,
      params,
    );
  }

  /**
   * Delete a database reference from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param name Name of the reference to be deleted. Name of the System DB, path of the sqlproj, or path of the dacpac
   */
  public async deleteDatabaseReference(
    projectUri: string,
    name: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.DeleteDatabaseReferenceParams = {
      projectUri: projectUri,
      name: name,
    };
    return this._client.sendRequest(
      contracts.DeleteDatabaseReferenceRequest.type,
      params,
    );
  }

  /**
   * Add a folder to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the folder, typically relative to the .sqlproj file
   */
  public async addFolder(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.FolderParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(contracts.AddFolderRequest.type, params);
  }

  /**
   * Delete a folder from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the folder, typically relative to the .sqlproj file
   */
  public async deleteFolder(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.FolderParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(contracts.DeleteFolderRequest.type, params);
  }

  /**
   * Add a post-deployment script to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async addPostDeploymentScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.AddPostDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Add a pre-deployment script to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async addPreDeploymentScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.AddPreDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Delete a post-deployment script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async deletePostDeploymentScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.DeletePostDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Delete a pre-deployment script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async deletePreDeploymentScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.DeletePreDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Exclude a post-deployment script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async excludePostDeploymentScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.ExcludePostDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Exclude a pre-deployment script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async excludePreDeploymentScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.ExcludePreDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Move a post-deployment script in a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   * @param destinationPath Destination path of the file or folder, relative to the .sqlproj
   */
  public async movePostDeploymentScript(
    projectUri: string,
    path: string,
    destinationPath: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.MoveItemParams = {
      projectUri: projectUri,
      destinationPath: destinationPath,
      path: path,
    };
    return this._client.sendRequest(
      contracts.MovePostDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Move a pre-deployment script in a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   * @param destinationPath Destination path of the file or folder, relative to the .sqlproj
   */
  public async movePreDeploymentScript(
    projectUri: string,
    path: string,
    destinationPath: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.MoveItemParams = {
      projectUri: projectUri,
      destinationPath: destinationPath,
      path: path,
    };
    return this._client.sendRequest(
      contracts.MovePreDeploymentScriptRequest.type,
      params,
    );
  }

  /**
   * Close a SQL project
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async closeProject(projectUri: string): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.CloseSqlProjectRequest.type,
      params,
    );
  }

  /**
   * Create a new SQL project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param sqlProjectType Type of SQL Project: SDK-style or Legacy
   * @param databaseSchemaProvider Database schema provider for the project, in the format
   * "Microsoft.Data.Tools.Schema.Sql.SqlXYZDatabaseSchemaProvider".
   * Case sensitive.
   * @param buildSdkVersion Version of the Microsoft.Build.Sql SDK for the project, if overriding the default
   */
  public async createProject(
    projectUri: string,
    sqlProjectType: mssql.ProjectType,
    databaseSchemaProvider?: string,
    buildSdkVersion?: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.CreateSqlProjectParams = {
      projectUri: projectUri,
      sqlProjectType: sqlProjectType,
      databaseSchemaProvider: databaseSchemaProvider,
      buildSdkVersion: buildSdkVersion,
    };
    return this._client.sendRequest(
      contracts.CreateSqlProjectRequest.type,
      params,
    );
  }

  /**
   * Get the cross-platform compatibility status for a project
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getCrossPlatformCompatibility(
    projectUri: string,
  ): Promise<mssql.GetCrossPlatformCompatibilityResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetCrossPlatformCompatibilityRequest.type,
      params,
    );
  }

  /**
   * Open an existing SQL project
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async openProject(projectUri: string): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.OpenSqlProjectRequest.type,
      params,
    );
  }

  /**
   * Update a SQL project to be cross-platform compatible
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async updateProjectForCrossPlatform(
    projectUri: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.UpdateProjectForCrossPlatformRequest.type,
      params,
    );
  }

  /**
   * Get the cross-platform compatibility status for a project
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getProjectProperties(
    projectUri: string,
  ): Promise<mssql.GetProjectPropertiesResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetProjectPropertiesRequest.type,
      params,
    );
  }
  /**
   * Set the DatabaseSource property of a .sqlproj file
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param databaseSource Source of the database schema, used in telemetry
   */
  public async setDatabaseSource(
    projectUri: string,
    databaseSource: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SetDatabaseSourceParams = {
      projectUri: projectUri,
      databaseSource: databaseSource,
    };
    return this._client.sendRequest(
      contracts.SetDatabaseSourceRequest.type,
      params,
    );
  }

  /**
   * Set the DatabaseSchemaProvider property of a SQL project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param databaseSchemaProvider New DatabaseSchemaProvider value, in the form "Microsoft.Data.Tools.Schema.Sql.SqlXYZDatabaseSchemaProvider"
   */
  public async setDatabaseSchemaProvider(
    projectUri: string,
    databaseSchemaProvider: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SetDatabaseSchemaProviderParams = {
      projectUri: projectUri,
      databaseSchemaProvider: databaseSchemaProvider,
    };
    return this._client.sendRequest(
      contracts.SetDatabaseSchemaProviderRequest.type,
      params,
    );
  }

  /**
   * Add a SQLCMD variable to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param name Name of the SQLCMD variable
   * @param defaultValue Default value of the SQLCMD variable
   */
  public async addSqlCmdVariable(
    projectUri: string,
    name: string,
    defaultValue: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.AddSqlCmdVariableParams = {
      projectUri: projectUri,
      name: name,
      defaultValue: defaultValue,
    };
    return this._client.sendRequest(
      contracts.AddSqlCmdVariableRequest.type,
      params,
    );
  }

  /**
   * Delete a SQLCMD variable from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param name Name of the SQLCMD variable to be deleted
   */
  public async deleteSqlCmdVariable(
    projectUri: string,
    name?: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.DeleteSqlCmdVariableParams = {
      projectUri: projectUri,
      name: name,
    };
    return this._client.sendRequest(
      contracts.DeleteSqlCmdVariableRequest.type,
      params,
    );
  }

  /**
   * Update an existing SQLCMD variable in a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param name Name of the SQLCMD variable
   * @param defaultValue Default value of the SQLCMD variable
   */
  public async updateSqlCmdVariable(
    projectUri: string,
    name: string,
    defaultValue: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.AddSqlCmdVariableParams = {
      projectUri: projectUri,
      name: name,
      defaultValue: defaultValue,
    };
    return this._client.sendRequest(
      contracts.UpdateSqlCmdVariableRequest.type,
      params,
    );
  }

  /**
   * Add a SQL object script to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async addSqlObjectScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.AddSqlObjectScriptRequest.type,
      params,
    );
  }

  /**
   * Delete a SQL object script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async deleteSqlObjectScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.DeleteSqlObjectScriptRequest.type,
      params,
    );
  }

  /**
   * Exclude a SQL object script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   */
  public async excludeSqlObjectScript(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.ExcludeSqlObjectScriptRequest.type,
      params,
    );
  }

  /**
   * Move a SQL object script in a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql, relative to the .sqlproj
   * @param destinationPath Destination path of the file or folder, relative to the .sqlproj
   */
  public async moveSqlObjectScript(
    projectUri: string,
    path: string,
    destinationPath: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.MoveItemParams = {
      projectUri: projectUri,
      destinationPath: destinationPath,
      path: path,
    };
    return this._client.sendRequest(
      contracts.MoveSqlObjectScriptRequest.type,
      params,
    );
  }

  /**
   * getDatabaseReferences
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getDatabaseReferences(
    projectUri: string,
  ): Promise<mssql.GetDatabaseReferencesResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetDatabaseReferencesRequest.type,
      params,
    );
  }

  /**
   * getFolders
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getFolders(projectUri: string): Promise<mssql.GetFoldersResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(contracts.GetFoldersRequest.type, params);
  }

  /**
   * getPostDeploymentScripts
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getPostDeploymentScripts(
    projectUri: string,
  ): Promise<mssql.GetScriptsResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetPostDeploymentScriptsRequest.type,
      params,
    );
  }

  /**
   * getPreDeploymentScripts
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getPreDeploymentScripts(
    projectUri: string,
  ): Promise<mssql.GetScriptsResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetPreDeploymentScriptsRequest.type,
      params,
    );
  }

  /**
   * getSqlCmdVariables
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getSqlCmdVariables(
    projectUri: string,
  ): Promise<mssql.GetSqlCmdVariablesResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetSqlCmdVariablesRequest.type,
      params,
    );
  }

  /**
   * getSqlObjectScripts
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getSqlObjectScripts(
    projectUri: string,
  ): Promise<mssql.GetScriptsResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(
      contracts.GetSqlObjectScriptsRequest.type,
      params,
    );
  }

  /**
   * Exclude a folder and its contents from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the folder, typically relative to the .sqlproj file
   */
  public async excludeFolder(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.FolderParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.ExcludeFolderRequest.type,
      params,
    );
  }

  /**
   * Move a folder and its contents within a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param sourcePath Source path of the folder, typically relative to the .sqlproj file
   * @param destinationPath Destination path of the folder, typically relative to the .sqlproj file
   */
  public async moveFolder(
    projectUri: string,
    sourcePath: string,
    destinationPath: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.MoveFolderParams = {
      projectUri: projectUri,
      path: sourcePath,
      destinationPath: destinationPath,
    };
    return this._client.sendRequest(contracts.MoveFolderRequest.type, params);
  }

  /**
   * Add a none script to a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql and .publish.xml, relative to the .sqlproj
   */
  public async addNoneItem(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(contracts.AddNoneItemRequest.type, params);
  }

  /**
   * Delete a none script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql and .publish.xml, relative to the .sqlproj
   */
  public async deleteNoneItem(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.DeleteNoneItemRequest.type,
      params,
    );
  }

  /**
   * Exclude a none script from a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the script, including .sql and .publish.xml, relative to the .sqlproj
   */
  public async excludeNoneItem(
    projectUri: string,
    path: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.SqlProjectScriptParams = {
      projectUri: projectUri,
      path: path,
    };
    return this._client.sendRequest(
      contracts.ExcludeNoneItemRequest.type,
      params,
    );
  }

  /**
   * getNoneScripts
   * @param projectUri Absolute path of the project, including .sqlproj
   */
  public async getNoneItems(
    projectUri: string,
  ): Promise<mssql.GetScriptsResult> {
    const params: mssql.SqlProjectParams = { projectUri: projectUri };
    return this._client.sendRequest(contracts.GetNoneItemsRequest.type, params);
  }

  /**
   * Move a none script in a project
   * @param projectUri Absolute path of the project, including .sqlproj
   * @param path Path of the file, including extension, relative to the .sqlproj
   * @param destinationPath Destination path of the file, relative to the .sqlproj
   */
  public async moveNoneItem(
    projectUri: string,
    path: string,
    destinationPath: string,
  ): Promise<mssql.ResultStatus> {
    const params: mssql.MoveItemParams = {
      projectUri: projectUri,
      destinationPath: destinationPath,
      path: path,
    };
    return this._client.sendRequest(contracts.MoveNoneItemRequest.type, params);
  }
}
