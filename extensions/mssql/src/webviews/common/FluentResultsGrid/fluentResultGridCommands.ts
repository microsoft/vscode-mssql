/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { JSX } from "react/jsx-runtime";
import { Column, SlickGrid } from "slickgrid-react";
import { WebviewKeyBinding } from "../../../sharedInterfaces/webview";
import { ISlickRange } from "../../../sharedInterfaces/queryResult";

/** Where a command can surface in the grid UI. */
export enum FluentResultCommandSurface {
    CommandBar = "commandBar",
    ContextMenu = "contextMenu",
    HeaderMenu = "headerMenu",
    GridMenu = "gridMenu",
}

/** Grid state handed to a command when it runs or is evaluated. */
export interface FluentResultCommandContext {
    grid: SlickGrid;
    selection: ISlickRange[];
    activeCell?: { row: number; cell: number };
    /** The column the surface was invoked on (header/context menus). */
    column?: Column;
}

/**
 * Represents a contributable command that can be executed in the Fluent Results Grid.
 */
export interface FluentResultCommand {
    id: string;
    /** Already-localized display label (host supplies). */
    title: string;
    /** Fluent icon for command bar / menus. */
    icon?: JSX.Element;

    /** Surfaces this command appears in, with optional ordering/grouping. */
    surfaces: FluentResultCommandSurface[];
    group?: string;
    order?: number;

    /** Host-owned key combo (resolved from WebviewKeyBindings), not hardcoded. */
    keybinding?: WebviewKeyBinding;

    /** Visibility + enablement, evaluated against current grid state. */
    isVisible?: (ctx: FluentResultCommandContext) => boolean;
    isEnabled?: (ctx: FluentResultCommandContext) => boolean;

    /** The actual behavior. */
    run: (ctx: FluentResultCommandContext) => void | Promise<void>;
}
