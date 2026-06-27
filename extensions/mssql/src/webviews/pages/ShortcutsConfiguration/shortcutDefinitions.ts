/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewAction } from "../../../sharedInterfaces/webview";
import { locConstants } from "../../common/locConstants";

export type ShortcutGroupId = "navigation" | "results" | "selection" | "copy";

export interface ShortcutItem {
    action: WebviewAction;
}

export interface ShortcutGroup {
    id: ShortcutGroupId;
    items: ShortcutItem[];
}

export const shortcutGroups: ShortcutGroup[] = [
    {
        id: "navigation",
        items: [
            { action: WebviewAction.QueryResultSwitchToResultsTab },
            { action: WebviewAction.QueryResultSwitchToMessagesTab },
            { action: WebviewAction.QueryResultSwitchToQueryPlanTab },
            { action: WebviewAction.QueryResultPrevGrid },
            { action: WebviewAction.QueryResultNextGrid },
        ],
    },
    {
        id: "results",
        items: [
            { action: WebviewAction.QueryResultSwitchToTextView },
            { action: WebviewAction.QueryResultMaximizeGrid },
            { action: WebviewAction.ResultGridSelectAll },
            { action: WebviewAction.ResultGridSelectRow },
            { action: WebviewAction.ResultGridSelectColumn },
            { action: WebviewAction.ResultGridToggleSort },
            { action: WebviewAction.ResultGridChangeColumnWidth },
            { action: WebviewAction.ResultGridOpenColumnMenu },
            { action: WebviewAction.ResultGridOpenFilterMenu },
        ],
    },
    {
        id: "selection",
        items: [
            { action: WebviewAction.ResultGridExpandSelectionLeft },
            { action: WebviewAction.ResultGridExpandSelectionRight },
            { action: WebviewAction.ResultGridExpandSelectionUp },
            { action: WebviewAction.ResultGridExpandSelectionDown },
            { action: WebviewAction.ResultGridMoveToRowStart },
            { action: WebviewAction.ResultGridMoveToRowEnd },
        ],
    },
    {
        id: "copy",
        items: [
            { action: WebviewAction.ResultGridCopySelection },
            { action: WebviewAction.ResultGridCopyWithHeaders },
            { action: WebviewAction.ResultGridCopyAllHeaders },
            { action: WebviewAction.ResultGridCopyAsCsv },
            { action: WebviewAction.ResultGridCopyAsJson },
            { action: WebviewAction.ResultGridCopyAsInsert },
            { action: WebviewAction.ResultGridCopyAsInClause },
            { action: WebviewAction.QueryResultSaveAsJson },
            { action: WebviewAction.QueryResultSaveAsCsv },
            { action: WebviewAction.QueryResultSaveAsExcel },
            { action: WebviewAction.QueryResultSaveAsInsert },
        ],
    },
];

export function getShortcutGroupLabel(
    groupId: ShortcutGroupId,
    loc: typeof locConstants.shortcutsConfiguration,
): string {
    switch (groupId) {
        case "navigation":
            return loc.shortcutGroupNavigation;
        case "results":
            return loc.shortcutGroupResults;
        case "selection":
            return loc.shortcutGroupSelection;
        case "copy":
            return loc.shortcutGroupCopyExport;
    }
}

export function getShortcutGroupDescription(
    groupId: ShortcutGroupId,
    loc: typeof locConstants.shortcutsConfiguration,
): string {
    switch (groupId) {
        case "navigation":
            return loc.shortcutGroupNavigationDescription;
        case "results":
            return loc.shortcutGroupResultsDescription;
        case "selection":
            return loc.shortcutGroupSelectionDescription;
        case "copy":
            return loc.shortcutGroupCopyExportDescription;
    }
}
