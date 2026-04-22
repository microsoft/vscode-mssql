/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import React, { useCallback, useMemo, useRef } from "react";
import { GridOption, SlickgridReact, SlickgridReactInstance } from "slickgrid-react";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-fluent.css";
import { handleFluentSlickGridTabNavigation } from "./fluentSlickGridKeyboardNavigation";
import "./fluentSlickGrid.css";

export {
    createFluentSlickGridCopyMenu,
    FLUENT_SLICK_GRID_COPY_COMMAND,
    getFluentSlickGridSelectionText,
} from "./fluentSlickGridCopy";

type FluentAutoResizeOptions = NonNullable<GridOption["autoResize"]>;

const baseFluentGridOption: GridOption = {
    alwaysShowVerticalScroll: true,
    contextMenu: {
        iconCollapseAllGroupsCommand: "fi fi-arrow-minimize",
        iconExpandAllGroupsCommand: "fi fi-arrow-maximize",
        iconClearGroupingCommand: "fi fi-dismiss",
        iconCopyCellValueCommand: "fi fi-copy",
        iconExportCsvCommand: "fi fi-arrow-download",
        iconExportExcelCommand: "fi fi-arrow-download",
        iconExportPdfCommand: "fi fi-arrow-download",
        iconExportTextDelimitedCommand: "fi fi-arrow-download",
        subItemChevronClass: "fi fi-chevron-right",
    },
    gridMenu: {
        iconCssClass: "fi fi-navigation",
        iconClearAllFiltersCommand: "fi fi-filter-dismiss",
        iconClearAllSortingCommand: "fi fi-arrow-sort",
        iconClearFrozenColumnsCommand: "fi fi-pin-off",
        iconExportCsvCommand: "fi fi-arrow-download",
        iconExportExcelCommand: "fi fi-arrow-download",
        iconExportPdfCommand: "fi fi-arrow-download",
        iconExportTextDelimitedCommand: "fi fi-arrow-download",
        iconRefreshDatasetCommand: "fi fi-arrow-sync",
        iconToggleDarkModeCommand: "fi fi-dark-theme",
        iconToggleFilterCommand: "fi fi-split-horizontal",
        iconTogglePreHeaderCommand: "fi fi-split-horizontal",
        subItemChevronClass: "fi fi-chevron-right",
    },
    headerMenu: {
        iconClearFilterCommand: "fi fi-filter-dismiss",
        iconClearSortCommand: "fi fi-arrow-sort",
        iconFilterShortcutSubMenu: "fi fi-filter",
        iconFreezeColumns: "fi fi-pin",
        iconUnfreezeColumns: "fi fi-pin-off",
        iconSortAscCommand: "fi fi-sort-arrow-up",
        iconSortDescCommand: "fi fi-sort-arrow-down",
        iconColumnHideCommand: "fi fi-dismiss",
        iconColumnResizeByContentCommand: "fi fi-arrow-bidirection",
        subItemChevronClass: "fi fi-chevron-right",
    },
    enableAutoResize: true,
    enableCellNavigation: true,
    enableColumnReorder: true,
    enableExcelCopyBuffer: true,
    enableTextSelectionOnCells: false,
    forceFitColumns: false,
};

export const baseFluentReadOnlyGridOption: GridOption = {
    autoFitColumnsOnFirstLoad: false,
    enableSorting: false,
    enableFiltering: false,
    enablePagination: false,
    enableColumnPicker: false,
    enableGridMenu: false,
    enableHeaderMenu: false,
    enableAutoTooltip: true,
    showHeaderRow: false,
    rowHeight: 25,
};

export function createFluentAutoResizeOptions(
    container: string,
    overrides: Partial<FluentAutoResizeOptions> = {},
): FluentAutoResizeOptions {
    return {
        container,
        calculateAvailableSizeBy: "container",
        resizeDetection: "container",
        ...overrides,
    };
}

type SlickgridReactPublicProps = React.JSX.LibraryManagedAttributes<
    typeof SlickgridReact,
    React.ComponentProps<typeof SlickgridReact>
>;

export interface FluentSlickGridProps extends Omit<SlickgridReactPublicProps, "options"> {
    options: GridOption;
    enableCellTabNavigation?: boolean;
}

export const FluentSlickGrid: React.FC<FluentSlickGridProps> = ({
    options,
    enableCellTabNavigation = false,
    onKeyDown,
    onReactGridCreated,
    ...props
}) => {
    const gridContainerRef = useRef<HTMLElement | undefined>(undefined);

    const mergedOptions = useMemo<GridOption>(
        () => ({
            ...baseFluentGridOption,
            ...options,
            contextMenu: {
                ...baseFluentGridOption.contextMenu,
                ...options.contextMenu,
            },
            gridMenu: {
                ...baseFluentGridOption.gridMenu,
                ...options.gridMenu,
            },
            headerMenu: {
                ...baseFluentGridOption.headerMenu,
                ...options.headerMenu,
            },
        }),
        [options],
    );

    const handleReactGridCreated = useCallback<
        NonNullable<SlickgridReactPublicProps["onReactGridCreated"]>
    >(
        (event) => {
            const reactGrid = event.detail as SlickgridReactInstance | undefined;
            gridContainerRef.current = reactGrid?.slickGrid?.getContainerNode?.();
            onReactGridCreated?.(event);
        },
        [onReactGridCreated],
    );

    const handleKeyDown = useCallback<NonNullable<SlickgridReactPublicProps["onKeyDown"]>>(
        (event) => {
            onKeyDown?.(event);

            if (enableCellTabNavigation) {
                return;
            }

            handleFluentSlickGridTabNavigation(event, gridContainerRef.current);
        },
        [enableCellTabNavigation, onKeyDown],
    );

    return (
        <SlickgridReact
            {...props}
            onKeyDown={handleKeyDown}
            onReactGridCreated={handleReactGridCreated}
            options={mergedOptions}
        />
    );
};
