/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect } from 'react';
import {data} from './demoGraph';
import { getBadgePaths, getCollapseExpandPaths, getIconPaths } from './queryPlanSetup';
import * as azdataGraphModule from 'azdataGraph/dist/build.js';
// @ts-ignore
const azdataGraph = azdataGraphModule();

const parseGraph = JSON.parse(data);

export const ExecutionPlanPage = () => {


	useEffect(() => {
		function loadGraph() {
			const div = document.getElementById('queryPlan0');
			var imageBasePath = './icons/';
			const queryPlanConfiguration = {
				container: div,
				queryPlanGraph: parseGraph,
				iconPath: getIconPaths(imageBasePath),
				badgeIconPaths: getBadgePaths(imageBasePath),
				expandCollapsePaths: getCollapseExpandPaths(imageBasePath),
				showTooltipOnClick: true
			};
			// @ts-ignore
			azdataGraph.azdataQueryPlan(queryPlanConfiguration);
		}
		loadGraph();

	}, []);

	return (
		<div>
			<h1>Execution Plan Page</h1>
			<div id="queryPlan0" style= {
				{
					width: '800px',
					height: '800px',
					position: 'relative',
					backgroundColor: 'white',
					overflow: 'auto'
				}
			}></div>
		</div>
	);
};