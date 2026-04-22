/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Column, GridOption } from "slickgrid-react";
import { ProfilerEventProperty } from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { baseFluentGridOption } from "../../common/FluentSlickGrid/fluentGridOptions";

export interface ProfilerDetailsGridRow {
    id: number;
    label: string;
    value: string;
}

export const PROFILER_DETAILS_GRID_ID = "profilerDetailsGrid";
export const PROFILER_DETAILS_GRID_CONTAINER_ID = "profilerDetailsGridContainer";
export const PROFILER_DETAILS_LABEL_COLUMN_WIDTH_PX = 220;
export const PROFILER_DETAILS_LABEL_COLUMN_MIN_WIDTH_PX = 160;
export const PROFILER_DETAILS_VALUE_COLUMN_WIDTH_PX = 640;
export const PROFILER_DETAILS_VALUE_COLUMN_MIN_WIDTH_PX = 220;

export function buildProfilerDetailsGridRows(
    properties: ProfilerEventProperty[],
): ProfilerDetailsGridRow[] {
    return properties.map((property, index) => ({
        id: index,
        label: property.label,
        value: property.value,
    }));
}

export function getProfilerDetailsGridColumns(propertyLabel: string, valueLabel: string): Column[] {
    return [
        {
            id: "label",
            name: propertyLabel,
            field: "label",
            width: PROFILER_DETAILS_LABEL_COLUMN_WIDTH_PX,
            minWidth: PROFILER_DETAILS_LABEL_COLUMN_MIN_WIDTH_PX,
            sortable: false,
            resizable: true,
            cssClass: "profiler-details-label-cell",
            excludeFromColumnPicker: true,
            excludeFromGridMenu: true,
            excludeFromHeaderMenu: true,
        },
        {
            id: "value",
            name: valueLabel,
            field: "value",
            width: PROFILER_DETAILS_VALUE_COLUMN_WIDTH_PX,
            minWidth: PROFILER_DETAILS_VALUE_COLUMN_MIN_WIDTH_PX,
            sortable: false,
            resizable: true,
            cssClass: "profiler-details-value-cell",
            excludeFromColumnPicker: true,
            excludeFromGridMenu: true,
            excludeFromHeaderMenu: true,
        },
    ];
}

export function getProfilerDetailsGridOptions(themeKind: ColorThemeKind): GridOption {
    return {
        ...baseFluentGridOption,
        autoFitColumnsOnFirstLoad: false,
        autoResize: {
            container: `#${PROFILER_DETAILS_GRID_CONTAINER_ID}`,
            calculateAvailableSizeBy: "container",
            resizeDetection: "container",
            bottomPadding: 0,
            minHeight: 50,
        },
        enableAutoResize: true,
        enableCellNavigation: true,
        enableColumnReorder: false,
        enableSorting: false,
        enableFiltering: false,
        enablePagination: false,
        enableColumnPicker: false,
        enableGridMenu: false,
        enableHeaderMenu: false,
        enableAutoTooltip: true,
        enableExcelCopyBuffer: true,
        enableTextSelectionOnCells: false,
        selectionOptions: {
            selectionType: "cell",
        },
        showHeaderRow: false,
        showColumnHeader: false,
        forceFitColumns: true,
        rowHeight: 25,
        headerRowHeight: 0,
        darkMode: themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
    };
}
