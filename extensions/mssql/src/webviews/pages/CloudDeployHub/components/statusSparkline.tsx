/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from "@fluentui/react-components";
import * as React from "react";
import { RunStatus } from "../../../../cloudDeploy/runs/types";

/**
 * Maps a run status to a solid bar color, mirroring the `StatusBadge` palette
 * so the sparkline reads as the same visual language as the status badges.
 */
const STATUS_BAR_COLOR: Record<RunStatus, string> = {
    [RunStatus.Passed]: tokens.colorPaletteGreenForeground1,
    [RunStatus.Skipped]: tokens.colorNeutralForeground3,
    [RunStatus.Cancelled]: tokens.colorNeutralForeground4,
    [RunStatus.Warning]: tokens.colorPaletteYellowForeground1,
    [RunStatus.Failed]: tokens.colorPaletteRedForeground1,
    [RunStatus.Errored]: tokens.colorPaletteDarkOrangeForeground1,
};

interface StatusSparklineProps {
    /** Statuses oldest-to-newest; only the most recent `max` are rendered. */
    readonly statuses: readonly RunStatus[];
    /** How many recent bars to show. Defaults to 5. */
    readonly max?: number;
}

/**
 * A compact horizontal bar chart of recent run statuses for an environment.
 * Each bar is one run, colored by outcome, oldest on the left. Purely visual —
 * a glanceable trend that complements the latest-status badge.
 */
export const StatusSparkline: React.FC<StatusSparklineProps> = ({ statuses, max = 5 }) => {
    const recent = statuses.slice(-max);
    const barWidth = 6;
    const gap = 3;
    const height = 16;
    const width = recent.length * (barWidth + gap);

    return (
        <svg width={width} height={height} role="img" style={{ display: "block" }}>
            {recent.map((status, index) => (
                <rect
                    key={index}
                    x={index * (barWidth + gap)}
                    y={2}
                    width={barWidth}
                    height={height - 4}
                    rx={1.5}
                    fill={STATUS_BAR_COLOR[status]}
                    opacity={0.85}
                />
            ))}
        </svg>
    );
};
