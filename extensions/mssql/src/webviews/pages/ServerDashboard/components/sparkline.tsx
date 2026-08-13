/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from "@fluentui/react-components";
import { type JSX } from "react";
import { DashboardMetricPoint } from "../../../../sharedInterfaces/serverDashboard";

export interface SparklineProps {
    points: DashboardMetricPoint[];
    status: "healthy" | "warning" | "critical";
    ariaLabel: string;
    height?: number;
}

export function Sparkline({ points, status, ariaLabel, height = 72 }: SparklineProps): JSX.Element {
    const width = 300;
    const values = points.map((point) => point.value);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = Math.max(max - min, 1);
    const path = points
        .map((point, index) => {
            const x = (index / Math.max(points.length - 1, 1)) * width;
            const y = height - ((point.value - min) / range) * (height - 10) - 5;
            return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ");
    const strokeColor =
        status === "critical"
            ? tokens.colorPaletteRedForeground1
            : status === "warning"
              ? tokens.colorPaletteDarkOrangeForeground1
              : tokens.colorBrandForeground1;

    return (
        <svg
            className="dashboard-sparkline"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={ariaLabel}>
            <line
                x1="0"
                y1={height - 1}
                x2={width}
                y2={height - 1}
                stroke={tokens.colorNeutralStroke2}
            />
            <path d={path} fill="none" stroke={strokeColor} strokeWidth="2.5" />
        </svg>
    );
}
