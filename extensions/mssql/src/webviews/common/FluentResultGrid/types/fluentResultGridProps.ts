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
    FluentResultGridCommandConfiguration,
    FluentResultGridCommandEvent,
    FluentResultGridToolbarOptions,
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
    rowHeight?: number;
    /** Windowed-source fetch size in rows (QO-7); default 50. */
    windowSize?: number;
    /** Autosize data-sample row bound (QO-7b); default 50. */
    autosizeSampleRows?: number;
    /** Autosize column-width ceiling in px; default FLUENT_RESULT_GRID_MAX_COLUMN_WIDTH. */
    autosizeMaxColumnWidth?: number;
    toolbar?: FluentResultGridToolbarOptions;
    commands?: FluentResultGridCommandConfiguration;
    enableColumnReorder?: boolean;
    viewMode?: FluentResultGridViewMode;
    canToggleViewMode?: boolean;
    canToggleMaximize?: boolean;
    isMaximized?: boolean;
}

export interface FluentResultGridCallbackProps {
    onCommand?: (event: FluentResultGridCommandEvent) => MaybePromise<void>;
    onStateChange?: (state: FluentResultGridState) => void;
    onSelectionSummaryChange?: (selection: readonly ISlickRange[]) => MaybePromise<void>;
    onInMemoryDataProcessingThresholdExceeded?: () => MaybePromise<void>;
    /** Called after SlickGrid has created and initialized its live grid instance. */
    onGridCreated?: () => void;
    /** Called for SlickGrid's post-render event. */
    onGridRendered?: () => void;
    /** Called when a previously created live grid instance is released. */
    onGridDisposed?: () => void;
}

export interface FluentResultGridProps
    extends FluentResultGridAppearanceProps,
        FluentResultGridBehaviorProps,
        FluentResultGridCallbackProps {
    gridId: FluentResultGridId;
    resultSetSummary: ResultSetSummary;
    dataSource: FluentResultGridDataSource;
    initialState?: FluentResultGridState;
    initialStateReady?: boolean;
}

export interface FluentResultGridHandle {
    focusGrid: () => void;
}
