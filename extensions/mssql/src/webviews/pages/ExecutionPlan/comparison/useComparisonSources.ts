/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from "react";

import {
    ExecutionPlanComparisonSource,
    GetInitialComparisonSourcesRequest,
    PickComparisonSourceRequest,
} from "../../../../sharedInterfaces/executionPlanComparison";
import { getErrorMessage } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { ComparisonSide, comparisonSides } from "./comparisonModel";

/** The plan a pane shows, and which of its statements. */
export interface ComparisonPaneSource {
    /** New for every plan a pane loads, so the pane resets even when the same file is reloaded. */
    key: number;
    source: ExecutionPlanComparisonSource;
    graphIndex: number;
}

/**
 * Holds the plans the comparison shows. A comparison starts with the plans it was opened with, if
 * any, and the user picks the rest.
 */
export function useComparisonSources() {
    const { extensionRpc } = useVscodeWebview();
    const [panes, setPanes] = useState<Partial<Record<ComparisonSide, ComparisonPaneSource>>>({});
    /** False until the extension says which plans, if any, the comparison starts with. */
    const [loaded, setLoaded] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>();
    const nextKeyRef = useRef(0);
    const pickVersionRef = useRef(0);

    const load = useCallback(
        (side: ComparisonSide, source: ExecutionPlanComparisonSource, graphIndex: number) =>
            setPanes((current) => ({
                ...current,
                [side]: { key: nextKeyRef.current++, source, graphIndex },
            })),
        [],
    );

    useEffect(() => {
        void extensionRpc
            .sendRequest(GetInitialComparisonSourcesRequest.type)
            .then(
                (initialSources) => {
                    for (const side of comparisonSides) {
                        const initialSource = initialSources[side];
                        if (initialSource) {
                            const { graphIndex, ...source } = initialSource;
                            load(side, source, graphIndex);
                        }
                    }
                },
                (error: unknown) => setErrorMessage(getErrorMessage(error)),
            )
            .finally(() => setLoaded(true));
    }, [extensionRpc, load]);

    /** A later pick wins, even when an earlier one finishes loading last. */
    const pickSource = useCallback(
        async (side: ComparisonSide) => {
            const version = ++pickVersionRef.current;
            try {
                const source = await extensionRpc.sendRequest(PickComparisonSourceRequest.type);
                if (version === pickVersionRef.current && source) {
                    setErrorMessage(undefined);
                    load(side, source, 0);
                }
            } catch (error) {
                if (version === pickVersionRef.current) {
                    setErrorMessage(getErrorMessage(error));
                }
            }
        },
        [extensionRpc, load],
    );

    const selectGraph = useCallback(
        (side: ComparisonSide, graphIndex: number) =>
            setPanes((current) => {
                const pane = current[side];
                return pane ? { ...current, [side]: { ...pane, graphIndex } } : current;
            }),
        [],
    );

    return { loaded, panes, errorMessage, pickSource, selectGraph };
}
