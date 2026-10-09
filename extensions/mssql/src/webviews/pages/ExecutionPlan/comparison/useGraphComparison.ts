/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useMemo, useRef, useState } from "react";

import { ExecutionPlanGraph } from "../../../../sharedInterfaces/executionPlan";
import {
    CompareExecutionPlanGraphsRequest,
    CompareExecutionPlanGraphsResult,
} from "../../../../sharedInterfaces/executionPlanComparison";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { getErrorMessage } from "../../../common/utils";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { buildExecutionPlanComparisonMaps } from "./comparisonModel";

interface GraphComparison {
    primary: ExecutionPlanGraph;
    secondary: ExecutionPlanGraph;
    status: ApiStatus;
    result?: CompareExecutionPlanGraphsResult;
    errorMessage?: string;
}

/** Finds the matching operators of the two graphs the panes show. */
export function useGraphComparison(
    primary: ExecutionPlanGraph | undefined,
    secondary: ExecutionPlanGraph | undefined,
) {
    const { extensionRpc } = useVscodeWebview();
    const [comparison, setComparison] = useState<GraphComparison>();
    const comparisonRef = useRef(comparison);

    useEffect(() => {
        comparisonRef.current = comparison;
    }, [comparison]);

    useEffect(() => {
        if (!primary || !secondary) {
            return;
        }
        // Swapping the panes swaps their matches, so there is nothing to ask the service.
        const previous = comparisonRef.current;
        if (previous?.result && previous.primary === secondary && previous.secondary === primary) {
            setComparison({
                primary,
                secondary,
                status: ApiStatus.Loaded,
                result: { primary: previous.result.secondary, secondary: previous.result.primary },
            });
            return;
        }
        // A newer pair of graphs supersedes this request, even if this one answers last.
        let superseded = false;
        const settle = (update: Partial<GraphComparison>) => {
            if (!superseded) {
                setComparison({ primary, secondary, status: ApiStatus.Loading, ...update });
            }
        };
        settle({});
        extensionRpc
            .sendRequest(CompareExecutionPlanGraphsRequest.type, {
                primary: primary.graphFile,
                secondary: secondary.graphFile,
            })
            .then(
                (result) => settle({ status: ApiStatus.Loaded, result }),
                (error: unknown) =>
                    settle({ status: ApiStatus.Error, errorMessage: getErrorMessage(error) }),
            );
        return () => {
            superseded = true;
        };
    }, [extensionRpc, primary, secondary]);

    // A comparison of other graphs is stale as soon as either pane changes.
    const current =
        comparison?.primary === primary && comparison?.secondary === secondary
            ? comparison
            : undefined;
    const maps = useMemo(
        () => buildExecutionPlanComparisonMaps(current?.result),
        [current?.result],
    );
    return { status: current?.status, errorMessage: current?.errorMessage, maps };
}
