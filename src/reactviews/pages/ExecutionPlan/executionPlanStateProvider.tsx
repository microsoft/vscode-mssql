/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ReactNode, createContext } from 'react';
import * as ep from './executionPlanInterfaces';
import { useVscodeWebview } from '../../common/vscodeWebViewProvider';
import { Theme } from '@fluentui/react-components';

export interface ExecutionPlanState {
	provider: ep.ExecutionPlanProvider;
	state: ep.ExecutionPlanWebViewState;
	theme: Theme;
}

const ExecutionPlanContext = createContext<ExecutionPlanState | undefined>(undefined);

interface ExecutionPlanContextProps {
	children: ReactNode;
}

const ExecutionPlanStateProvider: React.FC<ExecutionPlanContextProps> = ({ children }) => {
	const webViewState = useVscodeWebview<ep.ExecutionPlanWebViewState, ep.ExecutionPlanReducers>();
	const executionPlanState = webViewState?.state;
	return <ExecutionPlanContext.Provider value={
		{
			provider: {
				getExecutionPlan: function (planFile: ep.ExecutionPlanGraphInfo): Promise<ep.GetExecutionPlanResult> {
					webViewState?.extensionRpc.action('getExecutionPlan',
						{sqlPlanContent: planFile.graphFileContent}
					);

					if (!executionPlanState.executionPlan) {
						return Promise.reject(new Error('Execution plan is undefined'));
					}

					return Promise.resolve(executionPlanState.executionPlan);
				},
				saveExecutionPlan: function (sqlPlanContent: string): void {
					webViewState?.extensionRpc.action('saveExecutionPlan',
						{sqlPlanContent: sqlPlanContent}
					);
				},
				showPlanXml: function (sqlPlanContent: string): void {
					webViewState?.extensionRpc.action('showPlanXml',
						{sqlPlanContent: sqlPlanContent}
					);
				},
				showQuery: function (query: string): void {
					webViewState?.extensionRpc.action('showQuery',
						{query: query}
					);
				},
				updateTotalCost: function (totalCost: number): void {
					webViewState?.extensionRpc.action('updateTotalCost',
						{totalCost: totalCost}
					);
				},
			},
			state: webViewState?.state as ep.ExecutionPlanWebViewState,
			theme: webViewState?.theme
		}
	}>{children}</ExecutionPlanContext.Provider>;
};

export { ExecutionPlanContext, ExecutionPlanStateProvider }