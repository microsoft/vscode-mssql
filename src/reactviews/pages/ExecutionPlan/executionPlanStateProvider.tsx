/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { ReactNode, createContext, useContext } from 'react';
import * as ep from './executionPlanInterfaces';
import { VscodeWebviewContext } from '../../common/vscodeWebViewProvider';

export interface ExecutionPlanState {
	provider: ep.ExecutionPlanProvider;
	state: ep.ExecutionPlanWebViewState;
}

const ExecutionPlanContext = createContext<ExecutionPlanState | undefined>(undefined);

interface ExecutionPlanContextProps {
	children: ReactNode;
}

const ExecutionPlanStateProvider: React.FC<ExecutionPlanContextProps> = ({ children }) => {
	const webViewState = useContext(VscodeWebviewContext);
	const executionPlanState = webViewState?.state as ep.ExecutionPlanWebViewState;
	return <ExecutionPlanContext.Provider value={
		{
			provider: {
				getExecutionPlan : function(planFile): Promise<ep.GetExecutionPlanResult> {
					webViewState?.extensionRpc.action('getExecutionPlan',
						{sqlPlanContent: planFile.graphFileContent}
					);

					if (!executionPlanState.executionPlan) {
						return Promise.reject(new Error('Execution plan is undefined'));
					}

					return Promise.resolve(executionPlanState.executionPlan);
				}
			},
			state: webViewState?.state as ep.ExecutionPlanWebViewState
		}
	}>{children}</ExecutionPlanContext.Provider>;
};

export { ExecutionPlanContext, ExecutionPlanStateProvider }
