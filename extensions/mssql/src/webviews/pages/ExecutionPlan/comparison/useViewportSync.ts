/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef } from "react";

import { ExecutionPlanGraphController } from "../executionPlanGraphController";
import { ExecutionPlanViewport } from "../executionPlanViewport";
import { ComparisonSide, otherSide } from "./comparisonModel";

/**
 * A mirrored view is an exact copy, so only rounding separates it from its source. The tolerance
 * stays far below any real move, so the last frame of an animated zoom still reaches the other plan.
 */
function sameViewport(left: ExecutionPlanViewport, right: ExecutionPlanViewport): boolean {
    return (
        Math.abs(left.x - right.x) < 0.01 &&
        Math.abs(left.y - right.y) < 0.01 &&
        Math.abs(left.zoom - right.zoom) < 1e-6
    );
}

/**
 * While synced, zooming or scrolling one plan moves the other to the same view. Each move is
 * applied to the other plan only when it differs, so the echo of a mirrored move stops there.
 */
export function useViewportSync(
    controllers: Record<ComparisonSide, ExecutionPlanGraphController | null>,
    synced: boolean,
) {
    const controllersRef = useRef(controllers);
    const syncedRef = useRef(synced);

    useEffect(() => {
        controllersRef.current = controllers;
        syncedRef.current = synced;
        // Turning sync on, or a plan loading while it is on, lines the added plan up with the
        // primary one.
        const { primary, secondary } = controllers;
        if (synced && primary && secondary) {
            secondary.setViewport(primary.getViewport());
        }
    }, [controllers, synced]);

    return useCallback((side: ComparisonSide, viewport: ExecutionPlanViewport) => {
        const target = controllersRef.current[otherSide(side)];
        if (!syncedRef.current || !target || sameViewport(target.getViewport(), viewport)) {
            return;
        }
        target.setViewport(viewport);
    }, []);
}
