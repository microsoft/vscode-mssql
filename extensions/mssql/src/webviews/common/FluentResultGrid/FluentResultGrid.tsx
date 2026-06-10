/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { FluentResultGridToolbar } from "./FluentResultGridToolbar";
import { useFluentResultGridProvider } from "./FluentResultGridProvider";
import type { FluentResultGridCommandContext } from "./types/fluentResultGridCommands";
import type { FluentResultGridDataSource } from "./types/fluentResultGridDataSource";
import type { FluentResultGridHandle, FluentResultGridProps } from "./types/fluentResultGridProps";
import type { FluentResultGridHeightMode } from "./types/fluentResultGridState";

const useStyles = makeStyles({
    root: {
        display: "flex",
        minHeight: 0,
        minWidth: 0,
    },
    gridBody: {
        flexGrow: 1,
        minHeight: 0,
        minWidth: 0,
    },
});

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
    (
        {
            gridId,
            resultSetSummary,
            dataSource,
            heightMode,
            className,
            style,
            ariaLabel,
            toolbar,
            commands,
            viewMode = "grid",
            canToggleViewMode,
            canToggleMaximize,
            isMaximized,
            onCommand,
        },
        ref,
    ) => {
        const classes = useStyles();
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

        const classNames = [classes.root, theme?.className, className].filter(Boolean).join(" ");
        const label =
            ariaLabel ??
            strings.accessibility.gridAriaLabel(resultSetSummary.batchId, resultSetSummary.id);
        const commandContext = useMemo<FluentResultGridCommandContext>(
            () => ({
                gridId,
                batchId: resultSetSummary.batchId,
                resultId: resultSetSummary.id,
                viewMode,
                canToggleViewMode,
                canToggleMaximize,
                isMaximized,
            }),
            [
                canToggleMaximize,
                canToggleViewMode,
                gridId,
                isMaximized,
                resultSetSummary.batchId,
                resultSetSummary.id,
                viewMode,
            ],
        );

        return (
            <div
                ref={containerRef}
                className={classNames || undefined}
                style={containerStyle}
                tabIndex={0}
                role="region"
                aria-label={label}
                data-fluent-result-grid="true"
                data-grid-id={gridId}
                data-row-count={rowCount}>
                <div className={classes.gridBody} data-fluent-result-grid-body="true" />
                <FluentResultGridToolbar
                    toolbar={toolbar}
                    commands={commands}
                    commandContext={commandContext}
                    onCommand={onCommand}
                />
            </div>
        );
    },
);

FluentResultGrid.displayName = "FluentResultGrid";
