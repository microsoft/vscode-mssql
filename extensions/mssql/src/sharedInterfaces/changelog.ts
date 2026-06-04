/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RequestType } from "vscode-jsonrpc";
import { Icons } from "./icons";

export interface ChangelogWebviewState {
    mainContent: ContentGroup;
    secondaryContent: ContentGroup;
    sidebarContent: ContentEntry[];
    version: string;
    event?: ChangelogEvent;
}

export interface ChangelogEvent {
    mainTitle: string;
    secondaryTitle: string;
    location: ChangelogEventLocation;
    /** Event date (or start date for multi-day events) in YYYY-MM-DD format. */
    date: string;
    /** End date for multi-day events in YYYY-MM-DD format. */
    endDate?: string;
    actionButton: ChangelogEventActionButton;
    description: string[];
    codeSnippets: string[];
}

export interface ChangelogEventLocation {
    name: string;
    /** UTC offset in ±HH:MM form (e.g. "-05:00"). Defaults to "+00:00". */
    timezone?: string;
}

export interface ChangelogEventActionButton {
    text: string;
    url: string;
}

export interface ContentGroup {
    title: string;
    description?: string;
    entries: ContentEntry[];
}

export interface ContentEntry {
    title: string;
    isPreview?: boolean;
    icon?: string;
    description: string;
    codeSnippets?: string[];
    actions?: ChangelogAction[];
}

export interface ChangelogAction {
    label: string;
    type: "command" | "link" | "walkthrough";
    value: string;
    args?: unknown[];
    icon?: keyof Icons;
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
