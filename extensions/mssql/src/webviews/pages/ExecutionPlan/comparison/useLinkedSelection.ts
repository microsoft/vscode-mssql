/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from "react";

import { ExecutionPlanNode } from "../../../../sharedInterfaces/executionPlan";
import { ExecutionPlanGraphController } from "../executionPlanGraphController";
import { ComparisonSide, ExecutionPlanComparisonMaps, otherSide } from "./comparisonModel";

interface PaneSelection {
    controller: ExecutionPlanGraphController | null;
    selectedId?: string;
    /** Selection made here to follow the other pane, so its echo is not followed back. */
    followedId?: string;
}

function selectedNode(
    controller: ExecutionPlanGraphController | null,
    id: string | undefined,
): ExecutionPlanNode | undefined {
    const element = id ? controller?.getElementById(id) : undefined;
    return element && "name" in element ? element : undefined;
}

/**
 * Tracks each pane's graph controller and selected operator. Selecting an operator selects its
 * match in the other pane, without moving focus there.
 */
export function useLinkedSelection(maps: ExecutionPlanComparisonMaps) {
    const [controllers, setControllers] = useState<
        Record<ComparisonSide, ExecutionPlanGraphController | null>
    >({ primary: null, secondary: null });
    const [selectedNodes, setSelectedNodes] = useState<
        Record<ComparisonSide, ExecutionPlanNode | undefined>
    >({ primary: undefined, secondary: undefined });
    const panesRef = useRef<Record<ComparisonSide, PaneSelection>>({
        primary: { controller: null },
        secondary: { controller: null },
    });
    const mapsRef = useRef(maps);

    const followMatch = useCallback((side: ComparisonSide, id: string) => {
        const matches =
            side === "primary" ? mapsRef.current.primaryMatches : mapsRef.current.secondaryMatches;
        const matchingIds = matches.get(id);
        const target = panesRef.current[otherSide(side)];
        if (!target.controller || !matchingIds?.length) {
            return;
        }
        if (target.selectedId && matchingIds.includes(target.selectedId)) {
            return;
        }
        const element = target.controller.getElementById(matchingIds[0]);
        if (element && "name" in element) {
            target.followedId = element.id;
            target.controller.selectElement(element, false, false);
        }
    }, []);

    // Matches arrive after the panes render, so follow the selection the primary pane already has.
    useEffect(() => {
        mapsRef.current = maps;
        const selectedId = panesRef.current.primary.selectedId;
        if (selectedId) {
            followMatch("primary", selectedId);
        }
    }, [maps, followMatch]);

    const onSelectionChange = useCallback(
        (side: ComparisonSide, id: string) => {
            const pane = panesRef.current[side];
            pane.selectedId = id;
            setSelectedNodes((current) => ({
                ...current,
                [side]: selectedNode(pane.controller, id),
            }));
            const isEcho = pane.followedId === id;
            pane.followedId = undefined;
            if (!isEcho) {
                followMatch(side, id);
            }
        },
        [followMatch],
    );

    const onReady = useCallback(
        (side: ComparisonSide, controller: ExecutionPlanGraphController | null) => {
            const pane = panesRef.current[side];
            pane.controller = controller;
            pane.followedId = undefined;
            pane.selectedId = controller?.getSelectedElement()?.id;
            setControllers((current) => ({ ...current, [side]: controller }));
            setSelectedNodes((current) => ({
                ...current,
                [side]: selectedNode(controller, pane.selectedId),
            }));
            // A pane that remounts follows the selection the other pane already has.
            const otherSelectedId = panesRef.current[otherSide(side)].selectedId;
            if (controller && otherSelectedId) {
                followMatch(otherSide(side), otherSelectedId);
            }
        },
        [followMatch],
    );

    return { controllers, selectedNodes, onReady, onSelectionChange };
}
