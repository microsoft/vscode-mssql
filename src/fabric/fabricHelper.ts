/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { FabricSqlDbInfo, ISqlDbArtifact, IWorkspace } from "../sharedInterfaces/fabric";
import { HttpHelper } from "../http/httpHelper";

export class FabricHelper {
    static readonly fabricUriBase = vscode.Uri.parse("https://api.fabric.microsoft.com/v1/");
    constructor() {}

    public static async getFabricWorkspaces(): Promise<IWorkspace[]> {
        const response = await this.fetchFromFabric<{ value: IWorkspace[] }>("workspaces");

        return response.value;
    }

    public static async getFabricWorkspace(workspaceId: string): Promise<IWorkspace> {
        const response = await this.fetchFromFabric<IWorkspace>(`workspaces/${workspaceId}`);

        return response;
    }

    public static async getFabricDatabases(
        workspace: IWorkspace | string,
    ): Promise<FabricSqlDbInfo[]> {
        const workspacePromise =
            typeof workspace === "string" ? this.getFabricWorkspace(workspace) : workspace;

        const response = await this.fetchFromFabric<{ value: ISqlDbArtifact[] }>(
            `workspaces/${typeof workspace === "string" ? workspace : workspace.id}/sqlDatabases`,
        );

        const resolvedWorkspace = await workspacePromise;

        return response.value.map((db) => {
            return {
                server: db.properties.serverFqdn,
                database: db.properties.databaseName,
                workspace: resolvedWorkspace,
                tags: [],
            } as FabricSqlDbInfo;
        });
    }

    public static async fetchFromFabric<TResponse>(api: string): Promise<TResponse> {
        const uri = vscode.Uri.joinPath(this.fabricUriBase, api);
        const httpHelper = new HttpHelper();

        const scopes = ["https://analysis.windows.net/powerbi/api/.default"];

        const session = await vscode.authentication.getSession("microsoft", scopes, {
            createIfNone: true,
        });
        let token = session?.accessToken;

        const response = await httpHelper.makeGetRequest<TResponse>(uri.toString(), token);

        return response.data;
    }
}
