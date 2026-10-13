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
 * Tracks each pane's graph controller and selected operator. While linking is on, selecting an
 * operator in a similar area selects its match in the other pane, outlines it, and scrolls it
 * into view when it is off the canvas or under a panel, without moving focus there.
 */
export function useLinkedSelection(
    maps: ExecutionPlanComparisonMaps,
    linking: boolean,
    synced: boolean,
) {
    const [controllers, setControllers] = useState<
        Record<ComparisonSide, ExecutionPlanGraphController | null>
    >({ primary: null, secondary: null });
    const [selectedNodes, setSelectedNodes] = useState<
        Record<ComparisonSide, ExecutionPlanNode | undefined>
    >({ primary: undefined, secondary: undefined });
    const [linkedIds, setLinkedIds] = useState<Record<ComparisonSide, string | undefined>>({
        primary: undefined,
        secondary: undefined,
    });
    const panesRef = useRef<Record<ComparisonSide, PaneSelection>>({
        primary: { controller: null },
        secondary: { controller: null },
    });
    const mapsRef = useRef(maps);
    const linkingRef = useRef(linking);
    const syncedRef = useRef(synced);
    /** The pane the user last selected in, whose selection the other pane follows. */
    const sourceSideRef = useRef<ComparisonSide | undefined>(undefined);

    const setLinkedId = useCallback(
        (side: ComparisonSide, id: string | undefined) =>
            setLinkedIds((current) =>
                current[side] === id ? current : { ...current, [side]: id },
            ),
        [],
    );

    const followMatch = useCallback(
        (side: ComparisonSide, id: string) => {
            const targetSide = otherSide(side);
            const target = panesRef.current[targetSide];
            const matches =
                side === "primary"
                    ? mapsRef.current.primaryMatches
                    : mapsRef.current.secondaryMatches;
            const matchingIds = matches.get(id);
            if (!linkingRef.current || !target.controller || !matchingIds?.length) {
                setLinkedId(targetSide, undefined);
                return;
            }
            // Keep the other pane's selection when it is already one of the matches.
            const linkedId =
                target.selectedId && matchingIds.includes(target.selectedId)
                    ? target.selectedId
                    : matchingIds[0];
            const element = target.controller.getElementById(linkedId);
            if (!element || !("name" in element)) {
                setLinkedId(targetSide, undefined);
                return;
            }
            if (linkedId !== target.selectedId) {
                target.followedId = linkedId;
                target.controller.selectElement(element, false, false);
            }
            if (!syncedRef.current) {
                target.controller.revealElement(element);
            } else if (!target.controller.isElementInView(element)) {
                // Synced views share one transform, so the two plans' layout coordinates line up
                // and the point between the selection and its match is a point in both. Center
                // there to keep both in view where the two plans allow it.
                const source = panesRef.current[side].controller;
                const sourceElement = source?.getElementById(id);
                const selected = sourceElement && source?.getElementCenter(sourceElement);
                const match = target.controller.getElementCenter(element);
                if (selected && match) {
                    target.controller.centerAt({
                        x: (selected.x + match.x) / 2,
                        y: (selected.y + match.y) / 2,
                    });
                }
            }
            setLinkedId(targetSide, linkedId);
        },
        [setLinkedId],
    );

    /** Links again from the pane the user last selected in, as matches or the setting change. */
    const followSource = useCallback(() => {
        const sourceSide = sourceSideRef.current;
        const sourceId = sourceSide && panesRef.current[sourceSide].selectedId;
        if (sourceSide && sourceId) {
            followMatch(sourceSide, sourceId);
        }
    }, [followMatch]);

    useEffect(() => {
        syncedRef.current = synced;
    }, [synced]);

    useEffect(() => {
        mapsRef.current = maps;
        linkingRef.current = linking;
        if (linking) {
            followSource();
        } else {
            setLinkedIds({ primary: undefined, secondary: undefined });
        }
    }, [followSource, linking, maps]);

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
            // A pane reports its first selection as it mounts, before the user has chosen one.
            if (isEcho || !pane.controller) {
                return;
            }
            sourceSideRef.current = side;
            setLinkedId(side, undefined);
            followMatch(side, id);
        },
        [followMatch, setLinkedId],
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
            setLinkedId(side, undefined);
            if (sourceSideRef.current === side) {
                // The pane the user selected in has a new graph, so there is nothing to follow.
                sourceSideRef.current = undefined;
                setLinkedId(otherSide(side), undefined);
            } else if (controller) {
                // A pane that remounts follows the selection the other pane already has.
                followSource();
            }
        },
        [followSource, setLinkedId],
    );

    return { controllers, selectedNodes, linkedIds, onReady, onSelectionChange };
}
