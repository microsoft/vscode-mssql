/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ChangelogWebviewState {
    resources: ChangelogResource[];
    walkthroughs: ChangelogWalkthrough[];
    changes: ChangelogChangeItem[];
    version: string;
}

export interface ChangelogResource {
    label: string;
    url: string;
}

export interface ChangelogWalkthrough {
    label: string;
    walkthroughId: string;
}

export interface ChangelogChangeItem {
    title: string;
    description: string;
    documentationUrl?: string;
    commandId?: string;
}
