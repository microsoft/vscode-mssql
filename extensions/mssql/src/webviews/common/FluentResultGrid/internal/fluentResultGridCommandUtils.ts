/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FluentResultGridCommand } from "../types/fluentResultGridCommandIds";

export function isFluentResultGridHostCommand(commandId: string): boolean {
    switch (commandId) {
        case FluentResultGridCommand.SelectAll:
        case FluentResultGridCommand.ToggleSort:
        case FluentResultGridCommand.OpenFilter:
        case FluentResultGridCommand.OpenResizeDialog:
        case FluentResultGridCommand.FreezeColumn:
        case FluentResultGridCommand.UnfreezeColumn:
        case FluentResultGridCommand.ClearAllFilters:
        case FluentResultGridCommand.ClearSort:
        case FluentResultGridCommand.ShowAllColumns:
        case FluentResultGridCommand.ExpandSelectionLeft:
        case FluentResultGridCommand.ExpandSelectionRight:
        case FluentResultGridCommand.ExpandSelectionUp:
        case FluentResultGridCommand.ExpandSelectionDown:
        case FluentResultGridCommand.OpenColumnMenu:
        case FluentResultGridCommand.MoveToRowStart:
        case FluentResultGridCommand.MoveToRowEnd:
        case FluentResultGridCommand.SelectColumn:
        case FluentResultGridCommand.SelectRow:
            return false;
        default:
            return true;
    }
}
