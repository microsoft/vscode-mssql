/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CSSProperties } from "react";
import type {
    GridSettings,
    ISlickRange,
    ResultSetSummary,
    ResultsGridAutoSizeStyle,
} from "../../../../sharedInterfaces/queryResult";
import type {
    FluentResultGridCommandBarOptions,
    FluentResultGridCommandConfiguration,
    FluentResultGridCommandEvent,
} from "./fluentResultGridCommands";
import type { FluentResultGridDataSource } from "./fluentResultGridDataSource";
import type {
    FluentResultGridId,
    FluentResultGridViewMode,
    MaybePromise,
} from "./fluentResultGridPrimitives";
import type { FluentResultGridHeightMode, FluentResultGridState } from "./fluentResultGridState";

export interface FluentResultGridAppearanceProps {
    heightMode?: FluentResultGridHeightMode;
    className?: string;
    style?: CSSProperties;
    ariaLabel?: string;
}

export interface FluentResultGridBehaviorProps {
    showRowNumberColumn?: boolean;
    autoSizeColumnsMode?: ResultsGridAutoSizeStyle;
    inMemoryDataProcessingThreshold?: number;
    gridSettings?: GridSettings;
    commandBar?: FluentResultGridCommandBarOptions;
    commands?: FluentResultGridCommandConfiguration;
    viewMode?: FluentResultGridViewMode;
    canToggleViewMode?: boolean;
    canToggleMaximize?: boolean;
    isMaximized?: boolean;
}

export interface FluentResultGridCallbackProps {
    onCommand?: (event: FluentResultGridCommandEvent) => MaybePromise<void>;
    onStateChange?: (state: FluentResultGridState) => void;
    onSelectionSummaryChange?: (selection: readonly ISlickRange[]) => MaybePromise<void>;
}

export interface FluentResultGridProps
    extends FluentResultGridAppearanceProps,
        FluentResultGridBehaviorProps,
        FluentResultGridCallbackProps {
    gridId: FluentResultGridId;
    resultSetSummary: ResultSetSummary;
    dataSource: FluentResultGridDataSource;
    initialState?: FluentResultGridState;
}

export interface FluentResultGridHandle {
    focusGrid: () => void;
}
