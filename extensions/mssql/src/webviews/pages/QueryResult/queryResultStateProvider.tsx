/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCoreRPCs } from "../../common/utils";
import { useVscodeWebview } from "../../common/vscodeWebviewProvider";
import {
    CompareExecutionPlanNotification,
    ExecutionPlanProvider,
} from "../../../sharedInterfaces/executionPlan";
import { CoreRPCs } from "../../../sharedInterfaces/webview";
import {
    QueryResultPaneTabs,
    QueryResultReducers,
    QueryResultViewMode,
    QueryResultWebviewState,
} from "../../../sharedInterfaces/queryResult";
import { WebviewRpc } from "../../common/rpc";
import { ExecutionPlanRevealRequest } from "../ExecutionPlan/executionPlanPage";

export interface QueryResultReactProvider
    extends Omit<ExecutionPlanProvider, "getExecutionPlan">,
        CoreRPCs {
    extensionRpc: WebviewRpc<QueryResultReducers>;
    setResultTab: (tabId: QueryResultPaneTabs) => void;
    setResultViewMode: (viewMode: QueryResultViewMode) => void;
    /**
     * Gets the execution plan graph from the provider for a result set
     * @param uri the uri of the query result state this request is associated with
     */
    getExecutionPlan(uri: string): void;

    /**
     * Opens a file of type with with specified content. A plan from this result opens its Query
     * Plan tab scrolled to that plan instead.
     * @param content the content of the file
     * @param type the type of file to open
     */
    openFileThroughLink(content: string, type: string): void;
    /** The plan the Query Plan tab should scroll to after a plan link is opened. */
    executionPlanRevealRequest?: ExecutionPlanRevealRequest;
    showCopyIndicator: () => void;
    copyIndicatorVisible: boolean;
}

export const QueryResultCommandsContext = createContext<QueryResultReactProvider | undefined>(
    undefined,
);

interface QueryResultProviderProps {
    children: ReactNode;
}

/**
 * Finds the first plan in this result parsed from the given XML. Every plan keeps the XML of the
 * result set it came from, so this is the plan a link to that XML refers to.
 * @returns the plan's index, or -1 when the XML is not one of this result's plans.
 */
function findExecutionPlanGraphIndex(
    state: QueryResultWebviewState | undefined,
    content: string,
): number {
    if (!state?.isExecutionPlan) {
        return -1;
    }
    return (
        state.executionPlanState?.executionPlanGraphs?.findIndex(
            (graph) => graph.graphFile?.graphFileContent === content,
        ) ?? -1
    );
}

const QueryResultStateProvider: React.FC<QueryResultProviderProps> = ({ children }) => {
    const { extensionRpc, getSnapshot } = useVscodeWebview<
        QueryResultWebviewState,
        QueryResultReducers
    >();
    const [copyIndicatorVisible, setCopyIndicatorVisible] = useState(false);
    const [executionPlanRevealRequest, setExecutionPlanRevealRequest] = useState<
        ExecutionPlanRevealRequest | undefined
    >(undefined);
    const copyIndicatorTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const showCopyIndicator = useCallback(() => {
        if (copyIndicatorTimeoutRef.current) {
            clearTimeout(copyIndicatorTimeoutRef.current);
        }

        setCopyIndicatorVisible(true);
        copyIndicatorTimeoutRef.current = setTimeout(() => {
            setCopyIndicatorVisible(false);
            copyIndicatorTimeoutRef.current = undefined;
        }, 3000);
    }, []);

    const commands = useMemo<QueryResultReactProvider>(
        () => ({
            extensionRpc,
            ...getCoreRPCs<QueryResultReducers>(extensionRpc),
            copyIndicatorVisible,
            showCopyIndicator,
            setResultTab: (tabId: QueryResultPaneTabs) => {
                extensionRpc.action("setResultTab", { tabId });
            },
            setResultViewMode: (viewMode: QueryResultViewMode) => {
                extensionRpc.action("setResultViewMode", { viewMode });
            },

            openFileThroughLink: (content: string, type: string) => {
                const graphIndex = findExecutionPlanGraphIndex(getSnapshot(), content);
                if (graphIndex >= 0) {
                    setExecutionPlanRevealRequest({ graphIndex });
                    extensionRpc.action("setResultTab", {
                        tabId: QueryResultPaneTabs.ExecutionPlan,
                    });
                    return;
                }
                extensionRpc.action("openFileThroughLink", { content, type });
            },
            executionPlanRevealRequest,

            // Execution Plan commands

            /**
             * Gets the execution plan for a specific query result
             * @param uri the uri of the query result state this request is associated with
             */
            getExecutionPlan: (uri: string) => {
                extensionRpc.action("getExecutionPlan", { uri });
            },
            /**
             * Saves the execution plan for a specific query result
             * @param sqlPlanContent the content of the SQL plan to save
             */
            saveExecutionPlan: (sqlPlanContent: string) => {
                extensionRpc.action("saveExecutionPlan", { sqlPlanContent });
            },
            /**
             * Shows the XML representation of the execution plan for a specific query result
             * @param sqlPlanContent the content of the SQL plan to show
             */
            showPlanXml: (sqlPlanContent: string) => {
                extensionRpc.action("showPlanXml", { sqlPlanContent });
            },
            /**
             * Shows the query for a specific query result
             * @param query the query to show
             */
            showQuery: (query: string) => {
                extensionRpc.action("showQuery", { query });
            },
            /**
             * Updates the total cost for a specific query result
             * @param addedCost the cost to add to the total
             */
            updateTotalCost: (addedCost: number) => {
                extensionRpc.action("updateTotalCost", { addedCost });
            },
            compareExecutionPlan: (graphIndex: number) => {
                void extensionRpc.sendNotification(CompareExecutionPlanNotification.type, {
                    graphIndex,
                });
            },
        }),
        [
            extensionRpc,
            getSnapshot,
            copyIndicatorVisible,
            executionPlanRevealRequest,
            showCopyIndicator,
        ],
    );

    useEffect(() => {
        return () => {
            if (copyIndicatorTimeoutRef.current) {
                clearTimeout(copyIndicatorTimeoutRef.current);
            }
        };
    }, []);
    return (
        <QueryResultCommandsContext.Provider value={commands}>
            {children}
        </QueryResultCommandsContext.Provider>
    );
};

export { QueryResultStateProvider };
