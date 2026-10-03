/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { makeStyles } from "@fluentui/react-components";
import { ExecutionPlanStateProvider } from "../ExecutionPlan/executionPlanStateProvider";
import { ExecutionPlanPage } from "../ExecutionPlan/executionPlanPage";
import { QueryResultCommandsContext } from "./queryResultStateProvider";
import { useQueryResultSelector } from "./queryResultSelector";
import { QueryResultPaneTabs } from "../../../sharedInterfaces/queryResult";

const useStyles = makeStyles({
    queryResultContainer: {
        width: "100%",
        position: "relative",
        display: "flex",
        fontWeight: "normal",
    },
});

export const QueryExecutionPlanTab = () => {
    const classes = useStyles();
    const context = useContext(QueryResultCommandsContext);
    const isActiveTab = useQueryResultSelector<boolean>(
        (s) => s.tabStates?.resultPaneTab === QueryResultPaneTabs.ExecutionPlan,
    );
    return (
        <div
            id={"executionPlanResultsTab"}
            className={classes.queryResultContainer}
            style={{ height: "100%", minHeight: "300px" }}>
            <ExecutionPlanStateProvider>
                <ExecutionPlanPage
                    autoLoad={false}
                    // A hidden tab has no layout to scroll, so reveal the plan once it is shown.
                    revealRequest={isActiveTab ? context?.executionPlanRevealRequest : undefined}
                />
            </ExecutionPlanStateProvider>
        </div>
    );
};
