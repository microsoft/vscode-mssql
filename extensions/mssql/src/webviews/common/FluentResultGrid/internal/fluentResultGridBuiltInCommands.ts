/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    FluentResultGridCommand,
    type FluentResultGridBuiltInCommandId,
} from "../types/fluentResultGridCommandIds";
import {
    FluentResultGridCommandPlacement,
    type FluentResultGridBuiltInCommandContribution,
    type FluentResultGridCommandPlacementMap,
} from "../types/fluentResultGridCommands";

const placement = FluentResultGridCommandPlacement;

export const builtInFluentResultGridCommands: readonly FluentResultGridBuiltInCommandContribution[] =
    [
        {
            id: FluentResultGridCommand.SelectAll,
            label: "",
            placements: [placement.CellContextMenu, placement.Keyboard],
            groupId: "selection",
            order: 100,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.CopySelection,
            label: "",
            placements: [placement.CellContextMenu, placement.Keyboard],
            groupId: "clipboard",
            order: 200,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyWithHeaders,
            label: "",
            placements: [placement.CellContextMenu, placement.Keyboard],
            groupId: "clipboard",
            order: 210,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyHeaders,
            label: "",
            placements: [placement.CellContextMenu],
            groupId: "clipboard",
            order: 220,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyAsCsv,
            label: "",
            placements: [placement.CellContextMenu],
            groupId: "copyAs",
            order: 230,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyAsJson,
            label: "",
            placements: [placement.CellContextMenu],
            groupId: "copyAs",
            order: 240,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyAsInClause,
            label: "",
            placements: [placement.CellContextMenu],
            groupId: "copyAs",
            order: 250,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyAsInsertInto,
            label: "",
            placements: [placement.CellContextMenu],
            groupId: "copyAs",
            order: 260,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.CopyColumnName,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "clipboard",
            order: 270,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.SaveAsCsv,
            label: "",
            placements: [placement.Toolbar, placement.Keyboard],
            groupId: "export",
            order: 300,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.SaveAsJson,
            label: "",
            placements: [placement.Toolbar, placement.Keyboard],
            groupId: "export",
            order: 310,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.SaveAsExcel,
            label: "",
            placements: [placement.Toolbar, placement.Keyboard],
            groupId: "export",
            order: 320,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.SaveAsInsert,
            label: "",
            placements: [placement.Toolbar, placement.Keyboard],
            groupId: "export",
            order: 330,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.OpenCell,
            label: "",
            placements: [placement.Keyboard],
            groupId: "cell",
            order: 400,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.SwitchToGridView,
            label: "",
            placements: [placement.Toolbar],
            groupId: "view",
            order: 500,
            isVisible: (context) => !!context.canToggleViewMode && context.viewMode === "text",
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.SwitchToTextView,
            label: "",
            placements: [placement.Toolbar],
            groupId: "view",
            order: 510,
            isVisible: (context) => !!context.canToggleViewMode && context.viewMode !== "text",
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.Maximize,
            label: "",
            placements: [placement.Toolbar],
            groupId: "view",
            order: 520,
            isVisible: (context) => !!context.canToggleMaximize && !context.isMaximized,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.Restore,
            label: "",
            placements: [placement.Toolbar],
            groupId: "view",
            order: 530,
            isVisible: (context) => !!context.canToggleMaximize && !!context.isMaximized,
            handledBy: "host",
        },
        {
            id: FluentResultGridCommand.ToggleSort,
            label: "",
            placements: [placement.ColumnHeaderMenu, placement.Keyboard],
            groupId: "column",
            order: 600,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.OpenFilter,
            label: "",
            placements: [placement.ColumnHeaderMenu, placement.Keyboard],
            groupId: "column",
            order: 610,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.OpenResizeDialog,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "column",
            order: 620,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.FreezeColumn,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "column",
            order: 630,
            isVisible: (context) => !context.isColumnFrozen,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.UnfreezeColumn,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "column",
            order: 640,
            isVisible: (context) => !!context.isColumnFrozen,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ClearAllFilters,
            label: "",
            placements: [placement.GridMenu],
            groupId: "state",
            order: 700,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ClearSort,
            label: "",
            placements: [placement.GridMenu],
            groupId: "state",
            order: 710,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ShowAllColumns,
            label: "",
            placements: [placement.GridMenu],
            groupId: "state",
            order: 720,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ExpandSelectionLeft,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 800,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ExpandSelectionRight,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 810,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ExpandSelectionUp,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 820,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.ExpandSelectionDown,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 830,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.OpenColumnMenu,
            label: "",
            placements: [placement.Keyboard],
            groupId: "column",
            order: 840,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.MoveToRowStart,
            label: "",
            placements: [placement.Keyboard],
            groupId: "navigation",
            order: 850,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.MoveToRowEnd,
            label: "",
            placements: [placement.Keyboard],
            groupId: "navigation",
            order: 860,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.SelectColumn,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 870,
            handledBy: "grid",
        },
        {
            id: FluentResultGridCommand.SelectRow,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 880,
            handledBy: "grid",
        },
    ];

export const builtInFluentResultGridCommandPlacements: FluentResultGridCommandPlacementMap = {
    [placement.CellContextMenu]: builtInFluentResultGridCommands
        .filter((command) => command.placements.includes(placement.CellContextMenu))
        .map((command) => command.id),
    [placement.ColumnHeaderMenu]: builtInFluentResultGridCommands
        .filter((command) => command.placements.includes(placement.ColumnHeaderMenu))
        .map((command) => command.id),
    [placement.GridMenu]: builtInFluentResultGridCommands
        .filter((command) => command.placements.includes(placement.GridMenu))
        .map((command) => command.id),
    [placement.Toolbar]: builtInFluentResultGridCommands
        .filter((command) => command.placements.includes(placement.Toolbar))
        .map((command) => command.id),
    [placement.Keyboard]: builtInFluentResultGridCommands
        .filter((command) => command.placements.includes(placement.Keyboard))
        .map((command) => command.id),
};

export const builtInFluentResultGridCommandById = new Map<
    FluentResultGridBuiltInCommandId,
    FluentResultGridBuiltInCommandContribution
>(builtInFluentResultGridCommands.map((command) => [command.id, command]));
