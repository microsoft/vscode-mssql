/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IWorkspace {
    objectId: string;
    capacityId?: string; // supplied when getting a single workspace, but only sometimes when getting all workspaces (perhaps newer workspaces?)
    type: string;
    displayName: string;
    description: string;
    sourceControlInformation?: ISourceControlInformation;
}

/**
 * Git connection details for a workspace
 */
export interface ISourceControlInformation {
    /**
     * The name of the branch to clone; if not specified, the default branch will be cloned
     */
    branchName?: string;

    /**
     * The URL of the git repository
     */
    repository?: string;

    /**
     * The relative path to the workspace root within the repository
     */
    directoryName?: string;
}
