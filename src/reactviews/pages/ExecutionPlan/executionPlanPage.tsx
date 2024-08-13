/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { getBadgePaths, getCollapseExpandPaths, getIconPaths } from './queryPlanSetup';
import * as azdataGraph from 'azdataGraph/dist/build';
import 'azdataGraph/src/css/common.css';
import 'azdataGraph/src/css/explorer.css';
import './executionPlan.css';
import { Spinner } from '@fluentui/react-components';
import { ExecutionPlanView } from "./executionPlanView";

export const ExecutionPlanPage = () => {
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;

	useEffect(() => {
		if (!executionPlanState) return;
		// @ts-ignore
		window['mxLoadResources'] = false;
		// @ts-ignore
		window['mxForceIncludes'] = false;
		// @ts-ignore
		window['mxResourceExtension'] = '.txt';
		// @ts-ignore
		window['mxLoadStylesheets'] = false;
		// @ts-ignore
		window['mxBasePath'] = './src/reactviews/pages/ExecutionPlan/mxgraph';

		const mxClient = azdataGraph.default();
		console.log(mxClient);
		console.log("Execution Plan State: ", executionPlanState);

		function loadExecutionPlan() {
			if (executionPlanState && executionPlanState.executionPlanGraphs) {
				const executionPlanRootNode = executionPlanState.executionPlanGraphs[0].root;
				const executionPlanView = new ExecutionPlanView(executionPlanRootNode);
				const executionPlanGraph = executionPlanView.populate();
				console.log("Graph: ", executionPlanGraph);

				const div = document.getElementById('queryPlanParent');
				// create a div to hold the graph
				const queryPlanConfiguration = {
					container: div,
					queryPlanGraph: executionPlanGraph,
					iconPaths: getIconPaths(),
					badgeIconPaths: getBadgePaths(),
					expandCollapsePaths: getCollapseExpandPaths(),
					showTooltipOnClick: true
				};
				const pen = new mxClient.azdataQueryPlan(queryPlanConfiguration);
				pen.setTextFontColor('var(--vscode-editor-foreground)'); // set text color
				pen.setEdgeColor('var(--vscode-editor-foreground)'); // set edge color
				console.log(pen);
			}
			else {
				return;
			}
		}
		loadExecutionPlan();

	}, [executionPlanState]);

	return (
		<div>
			{executionPlanState && executionPlanState.executionPlanGraphs ? (
				<div>
					<div>{executionPlanState.query}</div>
					<div
						id="queryPlanParent"
						style={{
							position: 'relative',
							overflow: 'scroll',
							width: '1500px',
							height: '800px',
							cursor: 'default',
							border: '1px solid',
							color: 'white !important',
						}}
					></div>
				</div>
			) : (
				<Spinner label="Loading..." labelPosition="below" />
			)}
		</div>
	);
};