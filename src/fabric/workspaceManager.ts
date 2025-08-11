/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Logger } from "../models/logger";
import { IArtifact, IFabricApiClient } from "./api/fabricApiClient";
import { IWorkspace } from "./api/fabricExtension";

export class WorkspaceManager {
    private _currentWorkspace: IWorkspace | undefined;
    public get currentWorkspace(): IWorkspace | undefined {
        return this._currentWorkspace;
    }

    constructor(
        protected apiClient: IFabricApiClient,
        protected logger: Logger,
    ) {}

    public async getItemsInWorkspace(): Promise<IArtifact[]> {
        if (!this.currentWorkspace) {
            throw new Error(
                "The current workspace has not been set before retrieving artifacts called",
            );
        }
        const wspaceId = this.currentWorkspace.objectId;
        const res = await this.apiClient.sendRequest({
            method: "GET",
            pathTemplate: `/v1/workspaces/${wspaceId}/items`,
        });

        if (res.status !== 200) {
            // this will be caught by VSCode event handling and will show a VSCode.Error message, but we won't see it in the fabric log
            const errmsg = `Error retrieving Artifacts: ${res.status} ${res.bodyAsText ?? ""}`;
            this.logger.error(errmsg);
            throw new Error(errmsg);
        }

        let arrayArtifacts = res?.parsedBody;
        if (arrayArtifacts?.value) {
            // Public API changed. Daily changed to put the array under 'value', but the change isn't in DXT yet, so we need to try both
            arrayArtifacts = arrayArtifacts.value;
        }
        let artifacts: IArtifact[] = arrayArtifacts;

        // loop through all the artifacts and set artifact.fabricEnvironment to the current fabric environment
        artifacts.forEach((artifact) => {
            artifact.fabricEnvironment = "PROD"; //this.fabricEnvironmentProvider.getCurrent().env;
        });

        return artifacts;
    }

    /**
     * The set of all workspaces available to the logged in user.
     *
     * An error is issued if the user is not logged in
     *
     * @returns The set of all workspaces available to the logged in user
     */
    public async listWorkspaces(): Promise<IWorkspace[]> {
        // if (!(await this.isConnected())) {
        //     throw new FabricError(
        //         vscode.l10n.t("Currently not connected to Fabric"),
        //         "Currently not connected to Fabric",
        //     );
        // }

        const res = await this.apiClient?.sendRequest({
            method: "GET",
            pathTemplate: "/v1/workspaces",
        });
        if (res?.status !== 200) {
            throw new Error(`Error Getting Workspaces + ${res?.status}  ${res?.bodyAsText}`);
        }
        let arrayWSpaces = res?.parsedBody;
        if (arrayWSpaces?.value) {
            // Public API changed. Daily changed to put the array under 'value', but the change isn't in DXT yet, so we need to try both
            arrayWSpaces = arrayWSpaces.value;
        }
        if (!arrayWSpaces) {
            throw new Error("Get Workspace result parsedBody is null or undefined");
        }
        let workSpaces: IWorkspace[] = [];
        for (let item of arrayWSpaces) {
            const wspace: IWorkspace = {
                objectId: item.id,
                description: item.description,
                type: item.type,
                displayName: item.displayName,
                capacityId: item.capacityid,
            };
            workSpaces.push(wspace);
        }
        return workSpaces;
    }
}
