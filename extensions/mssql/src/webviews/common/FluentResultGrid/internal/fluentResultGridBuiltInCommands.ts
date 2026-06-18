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
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 100,
        },
        {
            id: FluentResultGridCommand.ToggleSort,
            label: "",
            placements: [placement.ColumnHeaderMenu, placement.Keyboard],
            groupId: "column",
            order: 200,
        },
        {
            id: FluentResultGridCommand.OpenFilter,
            label: "",
            placements: [placement.ColumnHeaderMenu, placement.Keyboard],
            groupId: "column",
            order: 210,
        },
        {
            id: FluentResultGridCommand.OpenResizeDialog,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "column",
            order: 220,
        },
        {
            id: FluentResultGridCommand.FreezeColumn,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "column",
            order: 230,
            isVisible: (context) => !context.isColumnFrozen,
        },
        {
            id: FluentResultGridCommand.UnfreezeColumn,
            label: "",
            placements: [placement.ColumnHeaderMenu],
            groupId: "column",
            order: 240,
            isVisible: (context) => !!context.isColumnFrozen,
        },
        {
            id: FluentResultGridCommand.ClearAllFilters,
            label: "",
            placements: [placement.GridMenu],
            groupId: "state",
            order: 300,
        },
        {
            id: FluentResultGridCommand.ClearSort,
            label: "",
            placements: [placement.GridMenu],
            groupId: "state",
            order: 310,
        },
        {
            id: FluentResultGridCommand.ShowAllColumns,
            label: "",
            placements: [placement.GridMenu],
            groupId: "state",
            order: 320,
        },
        {
            id: FluentResultGridCommand.ExpandSelectionLeft,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 800,
        },
        {
            id: FluentResultGridCommand.ExpandSelectionRight,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 810,
        },
        {
            id: FluentResultGridCommand.ExpandSelectionUp,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 820,
        },
        {
            id: FluentResultGridCommand.ExpandSelectionDown,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 830,
        },
        {
            id: FluentResultGridCommand.OpenColumnMenu,
            label: "",
            placements: [placement.Keyboard],
            groupId: "column",
            order: 840,
        },
        {
            id: FluentResultGridCommand.MoveToRowStart,
            label: "",
            placements: [placement.Keyboard],
            groupId: "navigation",
            order: 850,
        },
        {
            id: FluentResultGridCommand.MoveToRowEnd,
            label: "",
            placements: [placement.Keyboard],
            groupId: "navigation",
            order: 860,
        },
        {
            id: FluentResultGridCommand.SelectColumn,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 870,
        },
        {
            id: FluentResultGridCommand.SelectRow,
            label: "",
            placements: [placement.Keyboard],
            groupId: "selection",
            order: 880,
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
