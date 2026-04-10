/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { GridOption } from "slickgrid-react";

export const baseFluentGridOption: GridOption = {
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
};
