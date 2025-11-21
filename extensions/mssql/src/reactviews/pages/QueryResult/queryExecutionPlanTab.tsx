/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles } from "@fluentui/react-components";
import { ExecutionPlanStateProvider } from "../ExecutionPlan/executionPlanStateProvider";
import { ExecutionPlanPage } from "../ExecutionPlan/executionPlanPage";

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
  return (
    <div
      id={"executionPlanResultsTab"}
      className={classes.queryResultContainer}
      style={{ height: "100%", minHeight: "300px" }}
    >
      <ExecutionPlanStateProvider>
        <ExecutionPlanPage />
      </ExecutionPlanStateProvider>
    </div>
  );
};
