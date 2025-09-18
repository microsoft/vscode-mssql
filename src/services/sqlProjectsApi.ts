/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Wrapper to acquire sql-database-projects extension API
import * as vscode from "vscode";

export interface ISqlDatabaseProjectsApi {
    readPublishProfile: (uri: vscode.Uri) => Promise<unknown>;
    savePublishProfile: (
        profilePath: string,
        databaseName: string,
        connectionString: string,
        sqlCmd?: Map<string, string>,
        options?: unknown,
    ) => Promise<unknown>;
    promptToSaveProfile: (
        project: unknown,
        existing?: vscode.Uri,
    ) => Promise<vscode.Uri | undefined>;
}

const EXT_ID = "ms-mssql.sql-database-projects-vscode";

export async function getSqlProjectsApi(): Promise<ISqlDatabaseProjectsApi | undefined> {
    const ext = vscode.extensions.getExtension(EXT_ID);
    if (!ext) {
        return undefined;
    }
    if (!ext.isActive) {
        await ext.activate();
    }
    const api = ext.exports as ISqlDatabaseProjectsApi | undefined;
    return api;
}
