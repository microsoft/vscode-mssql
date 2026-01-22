/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc/browser";

export interface ChangelogWebviewState {
    resources: ChangelogResource[];
    walkthroughs: ChangelogWalkthrough[];
    changes: ChangelogChangeItem[];
    version: string;
}

export interface ChangelogHero {
    title: string;
    description: string;
    pill?: string;
    subtext?: string;
    badgeText?: string;
    cta?: ChangelogAction;
    dismissCommandId?: string;
}

export interface ChangelogResource {
    label: string;
    url: string;
}

export interface ChangelogWalkthrough {
    label: string;
    walkthroughId?: string;
    stepId?: string;
    url?: string;
}

export interface ChangelogChangeItem {
    title: string;
    icon?: string;
    description: string;
    codeSnippets?: string[];
    actions?: ChangelogAction[];
}

export interface ChangelogFooterNotice {
    message: string;
    actionLabel?: string;
    actionCommandId?: string;
    actionArgs?: unknown[];
}

export interface ChangelogAction {
    label: string;
    type: "command" | "link" | "walkthrough";
    value: string;
    args?: unknown[];
}

export interface ChangelogLinkRequestParams {
    url: string;
}

export namespace ChangelogLinkRequest {
    export const type = new RequestType<ChangelogLinkRequestParams, void, void>(
        "openChangelogLink",
    );
}

export interface ChangelogCommandRequestParams {
    commandId: string;
    args?: unknown[];
}

export namespace ChangelogCommandRequest {
    export const type = new RequestType<ChangelogCommandRequestParams, void, void>(
        "executeChangelogCommand",
    );
}

export namespace CloseChangelogRequest {
    export const type = new RequestType<void, void, void>("closeChangelog");
}

export namespace ChangelogDontShowAgainRequest {
    export const type = new RequestType<void, void, void>("dontShowChangelogAgain");
}
