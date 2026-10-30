/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createContext, type DragEvent, useContext } from "react";
import {
    MultiResultsDropTarget,
    MultiResultsGroup,
} from "../../../../sharedInterfaces/multiResults";

export interface MultiResultsActions {
    /** Shows the group holding the result, with the result focused. */
    focus(uri: string): void;
    move(uri: string, target: MultiResultsDropTarget): void;
    close(uri: string): void;
    setGroupSizes(groupId: string, sizes: number[]): void;
}

export const MultiResultsActionsContext = createContext<MultiResultsActions | undefined>(undefined);

export function useMultiResultsActions(): MultiResultsActions {
    const actions = useContext(MultiResultsActionsContext);
    if (!actions) {
        throw new Error("useMultiResultsActions must be used within MultiResultsPage");
    }
    return actions;
}

/** Drag data type for a result dragged within the multi-results view. */
const MULTI_RESULT_DRAG_TYPE = "application/vnd.mssql.query-result";

export function startMultiResultDrag(event: DragEvent, uri: string): void {
    event.dataTransfer.setData(MULTI_RESULT_DRAG_TYPE, uri);
    event.dataTransfer.effectAllowed = "move";
}

/** Whether a drag carries a result. Its URI can only be read once it is dropped. */
export function isMultiResultDrag(event: DragEvent): boolean {
    return event.dataTransfer.types.includes(MULTI_RESULT_DRAG_TYPE);
}

export function getDroppedMultiResult(event: DragEvent): string | undefined {
    return event.dataTransfer.getData(MULTI_RESULT_DRAG_TYPE) || undefined;
}

/**
 * Where a result goes when "Move to New Group" is chosen: on its own, just after its group.
 */
export function getNewGroupTarget(
    groups: readonly MultiResultsGroup[],
    group: MultiResultsGroup,
): MultiResultsDropTarget {
    return { kind: "newGroup", index: groups.indexOf(group) + 1 };
}
