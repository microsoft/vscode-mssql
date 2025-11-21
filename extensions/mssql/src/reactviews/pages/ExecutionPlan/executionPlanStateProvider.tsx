/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as ep from "../../../sharedInterfaces/executionPlan";

import { ReactNode, createContext, useMemo } from "react";
import { useVscodeWebview2 } from "../../common/vscodeWebviewProvider2";
import { getCoreRPCs2 } from "../../common/utils";

export interface ExecutionPlanContextProps extends ep.ExecutionPlanProvider {}

const ExecutionPlanContext = createContext<
  ExecutionPlanContextProps | undefined
>(undefined);

interface ExecutionPlanProviderProps {
  children: ReactNode;
}

const ExecutionPlanStateProvider: React.FC<ExecutionPlanProviderProps> = ({
  children,
}) => {
  const { extensionRpc } = useVscodeWebview2<
    ep.ExecutionPlanState,
    ep.ExecutionPlanReducers
  >();

  const commands = useMemo<ExecutionPlanContextProps>(
    () => ({
      ...getCoreRPCs2(extensionRpc),
      getExecutionPlan: function (): void {
        extensionRpc.action("getExecutionPlan", {});
      },
      saveExecutionPlan: function (sqlPlanContent: string): void {
        extensionRpc.action("saveExecutionPlan", {
          sqlPlanContent: sqlPlanContent,
        });
      },
      showPlanXml: function (sqlPlanContent: string): void {
        extensionRpc.action("showPlanXml", {
          sqlPlanContent: sqlPlanContent,
        });
      },
      showQuery: function (query: string): void {
        extensionRpc.action("showQuery", {
          query: query,
        });
      },
      updateTotalCost: function (addedCost: number): void {
        extensionRpc.action("updateTotalCost", {
          addedCost: addedCost,
        });
      },
    }),
    [extensionRpc],
  );

  return (
    <ExecutionPlanContext.Provider value={commands}>
      {children}
    </ExecutionPlanContext.Provider>
  );
};

export { ExecutionPlanContext, ExecutionPlanStateProvider };
