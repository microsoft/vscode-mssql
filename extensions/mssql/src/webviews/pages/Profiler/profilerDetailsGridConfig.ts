/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Column, GridOption } from "slickgrid-react";
import { ProfilerEventProperty } from "../../../sharedInterfaces/profiler";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";

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
        autoFitColumnsOnFirstLoad: false,
        autoResize: {
            container: `#${PROFILER_DETAILS_GRID_CONTAINER_ID}`,
            calculateAvailableSizeBy: "container",
            resizeDetection: "container",
            bottomPadding: 0,
            minHeight: 50,
        },
        enableSorting: false,
        enableFiltering: false,
        enablePagination: false,
        enableColumnPicker: false,
        enableGridMenu: false,
        enableHeaderMenu: false,
        enableAutoTooltip: true,
        showHeaderRow: false,
        rowHeight: 25,
        enableColumnReorder: false,
        selectionOptions: {
            selectionType: "cell",
        },
        showColumnHeader: false,
        forceFitColumns: true,
        headerRowHeight: 0,
        darkMode: themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast,
    };
}
