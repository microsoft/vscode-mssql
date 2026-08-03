/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ReactNode } from "react";
import type {
    FluentResultGridBuiltInCommandId,
    FluentResultGridCommandId,
} from "./fluentResultGridCommandIds";
import type {
    FluentResultGridCellContext,
    FluentResultGridColumnContext,
    FluentResultGridResultIdentity,
    FluentResultGridSelectionContext,
    FluentResultGridViewMode,
} from "./fluentResultGridPrimitives";
import type {
    FluentResultGridCommandDisplay,
    FluentResultGridStrings,
} from "./fluentResultGridStrings";

export const FluentResultGridCommandPlacement = {
    CellContextMenu: "cellContextMenu",
    ColumnHeaderMenu: "columnHeaderMenu",
    GridMenu: "gridMenu",
    Toolbar: "toolbar",
    Keyboard: "keyboard",
} as const;

export type FluentResultGridCommandPlacement =
    (typeof FluentResultGridCommandPlacement)[keyof typeof FluentResultGridCommandPlacement];

export type FluentResultGridCommandMenuPlacement = Extract<
    FluentResultGridCommandPlacement,
    "cellContextMenu" | "columnHeaderMenu" | "gridMenu"
>;

export interface FluentResultGridCommandContext
    extends FluentResultGridResultIdentity,
        FluentResultGridSelectionContext,
        FluentResultGridColumnContext {
    cell?: FluentResultGridCellContext;
    viewMode?: FluentResultGridViewMode;
    canToggleViewMode?: boolean;
    canToggleMaximize?: boolean;
    isMaximized?: boolean;
    isColumnFrozen?: boolean;
}

export interface FluentResultGridCommandContribution {
    /**
     * Stable command id. Custom ids should be namespaced.
     *
     * Example: "myExtension.exportAsMarkdown".
     */
    id: FluentResultGridCommandId;
    label: string;
    tooltip?: string;
    ariaLabel?: string;
    icon?: ReactNode;
    placements: readonly FluentResultGridCommandPlacement[];
    groupId?: string;
    order?: number;
    isVisible?: (context: FluentResultGridCommandContext) => boolean;
    isEnabled?: (context: FluentResultGridCommandContext) => boolean;
    isChecked?: (context: FluentResultGridCommandContext) => boolean;
}

export interface FluentResultGridBuiltInCommandContribution
    extends FluentResultGridCommandContribution {
    id: FluentResultGridBuiltInCommandId;
}

export interface FluentResultGridCommandEvent extends FluentResultGridCommandContext {
    commandId: FluentResultGridCommandId;
}

export function getFluentResultGridCommandTooltip(
    display: FluentResultGridCommandDisplay,
    shortcut?: string,
    formatCommandTooltip?: FluentResultGridStrings["formatCommandTooltip"],
): string {
    if (formatCommandTooltip) {
        return formatCommandTooltip({
            label: display.label,
            tooltip: display.tooltip,
            shortcut,
        });
    }

    const text = display.tooltip ?? display.label;
    return shortcut ? `${text} (${shortcut})` : text;
}

export interface FluentResultGridKeyCombination {
    key?: string;
    code?: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

export interface FluentResultGridKeyBinding {
    keyCombination: FluentResultGridKeyCombination | string;
    label?: string;
}

export type FluentResultGridKeyBindingMap = {
    [commandId: string]: FluentResultGridKeyBinding | undefined;
} & Partial<Record<FluentResultGridBuiltInCommandId, FluentResultGridKeyBinding>>;

export type FluentResultGridCommandPlacementMap = Partial<
    Record<FluentResultGridCommandPlacement, readonly FluentResultGridCommandId[]>
>;

export interface FluentResultGridCommandConfiguration {
    /**
     * Adds custom commands or overrides metadata for built-in commands.
     *
     * When a contribution uses a built-in id, it overrides the built-in descriptor fields.
     */
    contributions?: readonly FluentResultGridCommandContribution[];

    /**
     * Ordered command ids per placement. Omitted placements use built-in defaults.
     */
    placements?: FluentResultGridCommandPlacementMap;
}

export interface FluentResultGridToolbarOptions {
    visible?: boolean;

    /**
     * Optional toolbar-specific override. When omitted, command configuration placements determine
     * the toolbar contents.
     */
    commandIds?: readonly FluentResultGridCommandId[];
}
