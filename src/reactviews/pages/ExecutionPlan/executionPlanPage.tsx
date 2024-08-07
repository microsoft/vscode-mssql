/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from "react";
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { Spinner } from "@fluentui/react-components";

export const ExecutionPlan = () => {
  const state = useContext(ExecutionPlanContext);
  const executionPlanState = state?.state;
  const executionPlanProvider = state?.provider;
  if (!executionPlanState || !executionPlanProvider) {
    return null;
  }
  executionPlanProvider.getExecutionPlan({
    graphFileContent: executionPlanState.sqlPlanContent!,
    graphFileType: ".sqlplan",
  });
  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </head>
      <body>
        <div id="root">
          <div id="executionplanview" tabIndex={0}>
            {executionPlanState.query}
          </div>
          {executionPlanState.executionPlanGraphs ? (
            <div id="executionplanview" tabIndex={0}>
              {executionPlanState.executionPlanGraphs.length}
            </div>
          ) : (
            <Spinner label="Loading..." labelPosition="below" />
          )}
        </div>
      </body>
    </html>
  );
};
