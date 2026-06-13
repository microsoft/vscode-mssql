/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
    FluentResultGridCommandConfiguration,
    FluentResultGridCommandContext,
    FluentResultGridCommandEvent,
    FluentResultGridCommandMenuPlacement,
} from "../types/fluentResultGridCommands";
import type { FluentResultGridCommandId } from "../types/fluentResultGridCommandIds";
import type {
    FluentResultGridAnchorRect,
    FluentResultGridColumnId,
    FluentResultGridId,
    FluentResultGridPoint,
    MaybePromise,
} from "../types/fluentResultGridPrimitives";

export type FluentResultGridFilterValue = string | undefined;

export interface FluentResultGridFilterListItem {
    value: FluentResultGridFilterValue;
    displayText: string;
    index: number;
}

export interface FluentResultGridMenuOverlayState extends FluentResultGridPoint {
    kind: "menu";
    gridId: FluentResultGridId;
    placement: FluentResultGridCommandMenuPlacement;
    commandContext: FluentResultGridCommandContext;
    commands?: FluentResultGridCommandConfiguration;
    commandIds?: readonly FluentResultGridCommandId[];
    onCommand?: (event: FluentResultGridCommandEvent) => MaybePromise<void>;
}

export interface FluentResultGridFilterOverlayState {
    kind: "filterMenu";
    gridId: FluentResultGridId;
    columnId: FluentResultGridColumnId;
    anchorRect: FluentResultGridAnchorRect;
    items: FluentResultGridFilterListItem[];
    initialSelected: FluentResultGridFilterValue[];
    onApply: (selected: FluentResultGridFilterValue[]) => MaybePromise<void>;
    onClear: () => MaybePromise<void>;
    onDismiss: () => void;
}

export interface FluentResultGridResizeDialogOverlayState {
    kind: "resizeDialog";
    gridId: FluentResultGridId;
    columnId: FluentResultGridColumnId;
    columnName: string;
    anchorRect: FluentResultGridAnchorRect;
    initialWidth: number;
    minWidth?: number;
    maxWidth?: number;
    onSubmit: (width: number) => MaybePromise<void>;
    onDismiss: () => void;
}

export type FluentResultGridOverlayState =
    | { kind: "none" }
    | FluentResultGridMenuOverlayState
    | FluentResultGridFilterOverlayState
    | FluentResultGridResizeDialogOverlayState;

export type FluentResultGridActiveOverlayState = Exclude<
    FluentResultGridOverlayState,
    { kind: "none" }
>;

export type FluentResultGridDismissibleOverlayState = Extract<
    FluentResultGridOverlayState,
    { onDismiss: () => void }
>;
