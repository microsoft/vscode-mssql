/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import {data} from './demoGraph';
import { getBadgePaths, getCollapseExpandPaths, getIconPaths } from './queryPlanSetup';
import * as azdataGraph from 'azdataGraph/dist/build';
import 'azdataGraph/src/css/common.css';
import 'azdataGraph/src/css/explorer.css';
import './executionPlan.css';
const parseGraph = JSON.parse(data);

export const ExecutionPlanPage = () => {
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;

	if (!executionPlanState) {
		return null;
	}

	useEffect(() => {
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

		function loadGraph() {
			const div = document.getElementById('queryPlanParent');
			// create a div to hold the graph
			const queryPlanConfiguration = {
				container: div,
				queryPlanGraph: parseGraph,
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
		loadGraph();

	}, []);

	return (
		<div>
			<div id="queryPlanParent" style= {
				{
					position: 'relative',
					overflow: 'scroll',
					width: '1500px',
					height: '800px',
					cursor: 'default',
					border: '1px solid',
					color: 'white !important'
				}
			}></div>
		</div>
	);
};