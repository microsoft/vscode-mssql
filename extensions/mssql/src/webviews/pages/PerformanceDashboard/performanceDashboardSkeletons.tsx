/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    makeStyles,
    mergeClasses,
    Skeleton,
    SkeletonItem,
    SkeletonProps,
    tokens,
} from "@fluentui/react-components";
import { CSSProperties } from "react";
import { locConstants as loc } from "../../common/locConstants";

/*
 * Placeholders in the shape of the content that loads, so a view keeps its layout while it
 * reads, and the page does not jump when the data comes. A placeholder takes its space at once
 * but shows only after a short delay, so a fast read goes from empty to data without a flash.
 */

/** How long a read runs before its placeholder shows. */
const showDelay = "300ms";
const fadeDuration = "150ms";

const fadeIn = {
    from: { opacity: 0 },
    to: { opacity: 1 },
};

/**
 * The placeholder colors, a few shades from the editor background in each VS Code theme, in
 * place of Fluent's stencil colors, which stand out on a dark editor.
 */
const stencilColors = {
    "--colorNeutralStencil1": "var(--vscode-editorWidget-background)",
    "--colorNeutralStencil2": "var(--vscode-list-hoverBackground)",
    "--colorNeutralStencil1Alpha": "var(--vscode-editorWidget-background)",
    "--colorNeutralStencil2Alpha": "var(--vscode-list-hoverBackground)",
} as CSSProperties;

const useFadeStyles = makeStyles({
    // Content that replaces a placeholder fades in, so the change is not abrupt.
    content: {
        animationName: fadeIn,
        animationDuration: fadeDuration,
        animationTimingFunction: "ease-out",
        "@media (prefers-reduced-motion: reduce)": {
            animationName: "none",
        },
    },
    // Hidden during the delay; then fades in.
    placeholder: {
        animationName: fadeIn,
        animationDuration: fadeDuration,
        animationDelay: showDelay,
        animationTimingFunction: "ease-out",
        animationFillMode: "both",
        "@media (prefers-reduced-motion: reduce)": {
            animationDuration: "1ms",
        },
    },
});

/** The class for content that replaces a placeholder, so it fades in. */
export function useFadeInClass(): string {
    return useFadeStyles().content;
}

/** A Fluent skeleton with the dashboard's colors, a pulse, and the delay before it shows. */
export const DelayedSkeleton = ({ className, style, ...props }: SkeletonProps) => {
    const classes = useFadeStyles();
    return (
        <Skeleton
            aria-label={loc.common.loading}
            animation="pulse"
            {...props}
            className={mergeClasses(classes.placeholder, className)}
            style={{ ...stencilColors, ...style }}
        />
    );
};

const lineBorder = "1px solid var(--vscode-panel-border)";
/** The height of a grid row and its header, as in the grids. */
const rowHeight = 36;

const useStyles = makeStyles({
    chart: {
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "8px 0 28px 40px",
        boxSizing: "border-box",
    },
    // Lines where the chart's grid lines are, and an area that fills the chart.
    gridLine: {
        height: "1px",
        backgroundColor: "var(--vscode-panel-border)",
    },
    area: {
        flexGrow: 1,
        marginTop: "-1px",
        opacity: 0.6,
    },
    frame: {
        border: lineBorder,
        borderRadius: tokens.borderRadiusMedium,
        overflow: "hidden",
    },
    header: {
        display: "flex",
        alignItems: "center",
        gap: "16px",
        height: `${rowHeight}px`,
        padding: "0 12px",
        backgroundColor: tokens.colorNeutralBackground2,
    },
    row: {
        display: "flex",
        alignItems: "center",
        gap: "16px",
        height: `${rowHeight}px`,
        padding: "0 12px",
        borderTop: lineBorder,
    },
    narrow: {
        flex: "0 0 48px",
    },
    wide: {
        flex: "1 1 0",
    },
    number: {
        flex: "0 0 96px",
    },

    // The title row of a chart card: the headline on the left, the unit on the right.
    cardHeader: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "16px",
        height: "40px",
        boxSizing: "border-box",
        padding: "0 16px",
        borderBottom: lineBorder,
    },
    cardHeadline: {
        display: "flex",
        alignItems: "center",
        gap: "8px",
    },
    cardChart: {
        padding: "8px 16px 4px 8px",
    },
});

/** A placeholder for a short value, such as a number in a summary. */
export const ValueSkeleton = ({ width = 72, height = 20 }: { width?: number; height?: number }) => (
    <DelayedSkeleton>
        <SkeletonItem shape="rectangle" style={{ width, height }} />
    </DelayedSkeleton>
);

/** A placeholder for a chart of the given height: its grid lines and a filled area. */
export const ChartSkeleton = ({ height }: { height: number }) => {
    const classes = useStyles();
    return (
        <DelayedSkeleton className={classes.chart} style={{ height }}>
            <div className={classes.gridLine} />
            <div className={classes.gridLine} />
            <SkeletonItem shape="rectangle" className={classes.area} />
        </DelayedSkeleton>
    );
};

/** A placeholder for a chart card: the title row, and the chart below it. */
export const ChartCardSkeleton = ({ chartHeight }: { chartHeight: number }) => {
    const classes = useStyles();
    return (
        <DelayedSkeleton className={classes.frame}>
            <div className={classes.cardHeader}>
                <div className={classes.cardHeadline}>
                    <SkeletonItem style={{ width: 80, height: 12 }} />
                    <SkeletonItem style={{ width: 40, height: 20 }} />
                    <SkeletonItem style={{ width: 104, height: 12 }} />
                </div>
                <SkeletonItem style={{ width: 136, height: 12 }} />
            </div>
            <div className={classes.cardChart}>
                <ChartSkeleton height={chartHeight} />
            </div>
        </DelayedSkeleton>
    );
};

export interface TableSkeletonProps {
    /** The rows to show. Default 5. */
    readonly rows?: number;
    /** The number columns after the ID and the text. Default 3. */
    readonly numberColumns?: number;
    /** False leaves out the frame, for a grid inside another panel. Default true. */
    readonly framed?: boolean;
}

/** A placeholder for a grid: a header, and rows with an ID, a text, and numbers. */
export const TableSkeleton = ({
    rows = 5,
    numberColumns = 3,
    framed = true,
}: TableSkeletonProps) => {
    const classes = useStyles();
    const cells = (height: number) => (
        <>
            <SkeletonItem className={classes.narrow} style={{ height }} />
            <SkeletonItem className={classes.wide} style={{ height }} />
            {Array.from({ length: numberColumns }, (_, index) => (
                <SkeletonItem key={index} className={classes.number} style={{ height }} />
            ))}
        </>
    );
    return (
        <DelayedSkeleton className={framed ? classes.frame : undefined}>
            <div className={classes.header}>{cells(10)}</div>
            {Array.from({ length: rows }, (_, index) => (
                <div key={index} className={classes.row}>
                    {cells(12)}
                </div>
            ))}
        </DelayedSkeleton>
    );
};
