/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useMemo } from "react";
import { ExecutionPlanState } from "../../../sharedInterfaces/executionPlan";
import {
    QsSaveExecutionPlanRequest,
    QsShowPlanQueryRequest,
    QsShowPlanXmlRequest,
} from "../../../sharedInterfaces/queryStudio";
import { ApiStatus } from "../../../sharedInterfaces/webview";
import {
    ExecutionPlanPageContent,
    ExecutionPlanPageViewState,
} from "../ExecutionPlan/executionPlanPage";
import {
    ExecutionPlanContext,
    ExecutionPlanContextProps,
} from "../ExecutionPlan/executionPlanStateProvider";
import type { Rpc } from "./resultsGridShared";

const LOADING_PLAN_STATE: ExecutionPlanState = {
    loadState: ApiStatus.Loading,
    executionPlanGraphs: [],
    totalCost: 0,
};

export type QueryStudioExecutionPlanViewState = ExecutionPlanPageViewState;

export function QueryStudioExecutionPlanView(props: {
    rpc: Rpc;
    executionPlanState?: ExecutionPlanState | undefined;
    active?: boolean;
    initialViewState?: QueryStudioExecutionPlanViewState;
    onViewStateChange?: (viewState: QueryStudioExecutionPlanViewState) => void;
}) {
    const { rpc, executionPlanState, active, initialViewState, onViewStateChange } = props;
    const context = useMemo<ExecutionPlanContextProps>(
        () => ({
            getExecutionPlan: () => undefined,
            saveExecutionPlan: (sqlPlanContent: string) => {
                void rpc.sendRequest(QsSaveExecutionPlanRequest.type, { sqlPlanContent });
            },
            showPlanXml: (sqlPlanContent: string) => {
                void rpc.sendRequest(QsShowPlanXmlRequest.type, { sqlPlanContent });
            },
            showQuery: (query: string) => {
                void rpc.sendRequest(QsShowPlanQueryRequest.type, { query });
            },
            updateTotalCost: () => undefined,
        }),
        [rpc],
    );

    return (
        <ExecutionPlanContext.Provider value={context}>
            <div className="qs-query-plan-view">
                <ExecutionPlanPageContent
                    executionPlanState={executionPlanState ?? LOADING_PLAN_STATE}
                    active={active}
                    initialViewState={initialViewState}
                    onViewStateChange={onViewStateChange}
                />
            </div>
        </ExecutionPlanContext.Provider>
    );
}
