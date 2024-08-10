/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';
import {data} from './demoGraph';
import { getBadgePaths, getCollapseExpandPaths, getIconPaths } from './queryPlanSetup';
import * as azdataGraph from 'azdataGraph/dist/build';
import 'azdataGraph/src/css/common.css';
import 'azdataGraph/src/css/explorer.css';

const parseGraph = JSON.parse(data);

export const ExecutionPlanPage = () => {
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
			var imageBasePath = './icons/';
			const queryPlanConfiguration = {
				container: div,
				queryPlanGraph: parseGraph,
				iconPaths: getIconPaths(imageBasePath),
				badgeIconPaths: getBadgePaths(),
				expandCollapsePaths: getCollapseExpandPaths(),
				showTooltipOnClick: true
			};
			const pen = new mxClient.azdataQueryPlan(queryPlanConfiguration);
			console.log(pen);
		}
		loadGraph();

	}, []);

	return (
		<div>
			<h1>Execution Plan Page</h1>
			<div id="queryPlanParent" style= {
				{
					position: 'relative',
					overflow: 'scroll',
					width: '1500px',
					height: '800px',
					cursor: 'default',
					border: '1px solid',
					marginTop: '100px',
					marginLeft: '100px'
				}
			}></div>
		</div>
	);
};