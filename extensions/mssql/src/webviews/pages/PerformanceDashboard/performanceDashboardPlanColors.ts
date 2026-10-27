/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tokens } from "@fluentui/react-components";
import { DataVizPalette, getColorFromToken } from "@fluentui/react-charts";
import { useCallback } from "react";
import {
    PerformanceDashboardReducers,
    PerformanceDashboardState,
} from "../../../sharedInterfaces/performanceDashboard";
import { ColorThemeKind } from "../../../sharedInterfaces/webview";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";

/** The plans that get a palette color; more plans are gray, so that no color is used twice. */
const paletteSize = 8;

/**
 * The color of each plan of a query: the chart palette in plan ID order, the same in the Plans
 * table and the execution history. `planIds` is every plan of the query, ordered by plan ID.
 */
export function usePlanColor(planIds: readonly string[]): (planId: string) => string {
    const { themeKind } = useVscodeWebview<
        PerformanceDashboardState,
        PerformanceDashboardReducers
    >();
    const isDark = themeKind === ColorThemeKind.Dark || themeKind === ColorThemeKind.HighContrast;
    const key = planIds.join(",");
    return useCallback(
        (planId: string) => {
            const index = key.split(",").indexOf(planId);
            return index >= 0 && index < paletteSize
                ? getColorFromToken(
                      DataVizPalette[`color${index + 1}` as keyof typeof DataVizPalette],
                      isDark,
                  )
                : tokens.colorNeutralForeground3;
        },
        [key, isDark],
    );
}
