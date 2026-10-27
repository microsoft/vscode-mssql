/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Column, ContextMenu, SlickgridReactInstance } from "slickgrid-react";

export const FLUENT_SLICK_GRID_COPY_COMMAND = "copy";

interface FluentSlickGridRange {
    fromRow: number;
    toRow: number;
    fromCell: number;
    toCell: number;
}

export function createFluentSlickGridCopyMenu(copyLabel: string): ContextMenu {
    return {
        hideCommands: [FLUENT_SLICK_GRID_COPY_COMMAND],
        hideCloseButton: true,
        commandItems: [
            {
                command: FLUENT_SLICK_GRID_COPY_COMMAND,
                title: copyLabel,
                iconCssClass: "fi fi-copy",
                positionOrder: 1,
            },
        ],
    };
}

export function getFluentSlickGridSelectionText(
    reactGrid: Pick<SlickgridReactInstance, "slickGrid" | "dataView"> | undefined,
    options: { includeHeaders?: boolean; headersOnly?: boolean } = {},
): string | undefined {
    const grid = reactGrid?.slickGrid;
    const dataView = reactGrid?.dataView;
    if (!grid || !dataView) {
        return undefined;
    }

    const visibleColumns = grid.getVisibleColumns() as Column[];
    const selectionModel = grid.getSelectionModel();
    const selectedRanges = (selectionModel?.getSelectedRanges() || []) as FluentSlickGridRange[];

    const rangesToProcess =
        selectedRanges.length > 0
            ? selectedRanges.map((range) => ({
                  fromRow: Math.min(range.fromRow, range.toRow),
                  toRow: Math.max(range.fromRow, range.toRow),
                  fromCell: Math.min(range.fromCell, range.toCell),
                  toCell: Math.max(range.fromCell, range.toCell),
              }))
            : (() => {
                  const activeCell = grid.getActiveCell();
                  return activeCell
                      ? [
                            {
                                fromRow: activeCell.row,
                                toRow: activeCell.row,
                                fromCell: activeCell.cell,
                                toCell: activeCell.cell,
                            },
                        ]
                      : [];
              })();

    if (rangesToProcess.length === 0) {
        return undefined;
    }

    const lines: string[] = [];
    for (const range of rangesToProcess) {
        const selectedColumns = visibleColumns.slice(range.fromCell, range.toCell + 1);
        if (options.includeHeaders || options.headersOnly) {
            lines.push(selectedColumns.map((column) => String(column.name ?? "")).join("\t"));
        }
        if (options.headersOnly) {
            continue;
        }
        for (let row = range.fromRow; row <= range.toRow; row++) {
            const item = dataView.getItem(row);
            if (!item) {
                continue;
            }

            lines.push(
                selectedColumns
                    .map((column) => {
                        if (!column.field) {
                            return "";
                        }
                        return item[column.field]?.toString() || "";
                    })
                    .join("\t"),
            );
        }
    }

    return lines.join("\n");
}
