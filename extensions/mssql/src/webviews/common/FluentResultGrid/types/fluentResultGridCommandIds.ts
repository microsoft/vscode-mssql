/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Stable built-in command ids.
 *
 * These are intentionally namespaced. Consumer-contributed command ids should also be namespaced,
 * for example: "myExtension.exportAsMarkdown".
 */
export const FluentResultGridCommand = {
    SelectAll: "fluentResultGrid.selectAll",

    CopySelection: "fluentResultGrid.copySelection",
    CopyWithHeaders: "fluentResultGrid.copyWithHeaders",
    CopyHeaders: "fluentResultGrid.copyHeaders",
    CopyAsCsv: "fluentResultGrid.copyAsCsv",
    CopyAsJson: "fluentResultGrid.copyAsJson",
    CopyAsInClause: "fluentResultGrid.copyAsInClause",
    CopyAsInsertInto: "fluentResultGrid.copyAsInsertInto",
    CopyColumnName: "fluentResultGrid.copyColumnName",

    SaveAsCsv: "fluentResultGrid.saveAsCsv",
    SaveAsJson: "fluentResultGrid.saveAsJson",
    SaveAsExcel: "fluentResultGrid.saveAsExcel",
    SaveAsInsert: "fluentResultGrid.saveAsInsert",

    OpenCell: "fluentResultGrid.openCell",

    SwitchToGridView: "fluentResultGrid.switchToGridView",
    SwitchToTextView: "fluentResultGrid.switchToTextView",
    Maximize: "fluentResultGrid.maximize",
    Restore: "fluentResultGrid.restore",

    ToggleSort: "fluentResultGrid.toggleSort",
    OpenFilter: "fluentResultGrid.openFilter",
    OpenResizeDialog: "fluentResultGrid.openResizeDialog",
    FreezeColumn: "fluentResultGrid.freezeColumn",
    UnfreezeColumn: "fluentResultGrid.unfreezeColumn",

    ClearAllFilters: "fluentResultGrid.clearAllFilters",
    ClearSort: "fluentResultGrid.clearSort",
    ShowAllColumns: "fluentResultGrid.showAllColumns",

    ExpandSelectionLeft: "fluentResultGrid.expandSelectionLeft",
    ExpandSelectionRight: "fluentResultGrid.expandSelectionRight",
    ExpandSelectionUp: "fluentResultGrid.expandSelectionUp",
    ExpandSelectionDown: "fluentResultGrid.expandSelectionDown",

    OpenColumnMenu: "fluentResultGrid.openColumnMenu",
    MoveToRowStart: "fluentResultGrid.moveToRowStart",
    MoveToRowEnd: "fluentResultGrid.moveToRowEnd",
    SelectColumn: "fluentResultGrid.selectColumn",
    SelectRow: "fluentResultGrid.selectRow",
} as const;

export type FluentResultGridBuiltInCommandId =
    (typeof FluentResultGridCommand)[keyof typeof FluentResultGridCommand];

export type FluentResultGridCustomCommandId = string & {};

export type FluentResultGridCommandId =
    | FluentResultGridBuiltInCommandId
    | FluentResultGridCustomCommandId;
