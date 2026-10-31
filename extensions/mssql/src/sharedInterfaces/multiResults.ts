/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NotificationType, RequestType } from "vscode-jsonrpc";
import type { QueryResultReducers, QueryResultWebviewState } from "./queryResult";

/**
 * Summary of one file's results, shown in the results list of the multi-results layout.
 */
export interface MultiResultsEntry {
    uri: string;
    title: string;
    resultSetCount: number;
    isExecuting: boolean;
    hasError: boolean;
    /** The file's editor is closed. Its results stay until they are closed from the list. */
    isDocumentClosed: boolean;
}

/**
 * Results shown side by side. A result that is not split with any other is a group of one.
 */
export interface MultiResultsGroup {
    id: string;
    /** Results in display order. Never empty. */
    uris: string[];
    /** Pane sizes in percent, in the same order as `uris`. Unset means equal sizes. */
    sizes?: number[];
    /** The result in this group that keyboard shortcuts act on. */
    focusedUri: string;
}

/**
 * Layout of the results view when the multi-results preview is enabled.
 */
export interface MultiResultsState {
    /** Keyed by result URI. */
    entries: Record<string, MultiResultsEntry>;
    /** Groups in list order. */
    groups: MultiResultsGroup[];
    activeGroupId?: string;
    followActiveEditor: boolean;
}

/**
 * Where a dragged result is dropped: into an existing group, or into a new group of its own.
 * Indexes refer to positions before the dragged result is removed from where it was.
 */
export type MultiResultsDropTarget =
    | { kind: "joinGroup"; groupId: string; index: number }
    | { kind: "newGroup"; index: number };

export namespace GetMultiResultsFileStateRequest {
    export const type = new RequestType<{ uri: string }, QueryResultWebviewState | undefined, void>(
        "multiResults/getFileState",
    );
}

/**
 * Sent to the results view when the state of a result in the active group changes.
 */
export namespace MultiResultsFileStateNotification {
    export const type = new NotificationType<{ uri: string; state: QueryResultWebviewState }>(
        "multiResults/fileState",
    );
}

export interface MultiResultsPaneActionParams {
    uri: string;
    type: keyof QueryResultReducers;
    payload: unknown;
}

/**
 * Runs a query result reducer against one result instead of the view's own state.
 */
export namespace MultiResultsPaneActionRequest {
    export const type = new RequestType<MultiResultsPaneActionParams, void, void>(
        "multiResults/paneAction",
    );
}

/**
 * Shows the group that holds the result and gives the result focus within it.
 */
export namespace FocusMultiResultNotification {
    export const type = new NotificationType<{ uri: string }>("multiResults/focus");
}

export namespace MoveMultiResultNotification {
    export const type = new NotificationType<{ uri: string; target: MultiResultsDropTarget }>(
        "multiResults/move",
    );
}

/**
 * Discards a result, cancelling its query if it is still running.
 */
export namespace CloseMultiResultNotification {
    export const type = new NotificationType<{ uri: string }>("multiResults/close");
}

export namespace SetMultiResultsGroupSizesNotification {
    export const type = new NotificationType<{ groupId: string; sizes: number[] }>(
        "multiResults/setGroupSizes",
    );
}
