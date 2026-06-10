/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { useFluentResultGridProvider } from "./FluentResultGridProvider";
import type { FluentResultGridDataSource } from "./types/fluentResultGridDataSource";
import type { FluentResultGridHandle, FluentResultGridProps } from "./types/fluentResultGridProps";
import type { FluentResultGridHeightMode } from "./types/fluentResultGridState";

function getDataSourceRowCount(dataSource: FluentResultGridDataSource): number {
    return dataSource.kind === "rows"
        ? (dataSource.rowCount ?? dataSource.rows.length)
        : dataSource.rowCount;
}

function getHeightModeStyle(heightMode: FluentResultGridHeightMode | undefined) {
    if (!heightMode || heightMode.kind === "fill") {
        return {
            height: "100%",
        };
    }

    return {
        minHeight: heightMode.minHeight,
        maxHeight: heightMode.maxHeight,
    };
}

/**
 * Reusable SQL result grid shell. It must be rendered inside FluentResultGridProvider so shared
 * strings, keybindings, theme metadata, and grid-owned overlays can be coordinated across grids.
 */
export const FluentResultGrid = forwardRef<FluentResultGridHandle, FluentResultGridProps>(
    ({ gridId, resultSetSummary, dataSource, heightMode, className, style, ariaLabel }, ref) => {
        const { strings, theme } = useFluentResultGridProvider();
        const containerRef = useRef<HTMLDivElement>(null);
        const rowCount = getDataSourceRowCount(dataSource);

        useImperativeHandle(
            ref,
            () => ({
                focusGrid: () => {
                    containerRef.current?.focus();
                },
            }),
            [],
        );

        const containerStyle = useMemo(
            () => ({
                ...getHeightModeStyle(heightMode),
                ...theme?.style,
                ...style,
            }),
            [heightMode, style, theme?.style],
        );

        const classes = [theme?.className, className].filter(Boolean).join(" ");
        const label =
            ariaLabel ??
            strings.accessibility.gridAriaLabel(resultSetSummary.batchId, resultSetSummary.id);

        return (
            <div
                ref={containerRef}
                className={classes || undefined}
                style={containerStyle}
                tabIndex={0}
                role="region"
                aria-label={label}
                data-fluent-result-grid="true"
                data-grid-id={gridId}
                data-row-count={rowCount}
            />
        );
    },
);

FluentResultGrid.displayName = "FluentResultGrid";
