/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { getBadgePaths, getCollapseExpandPaths, getIconPaths, openPlanFile, openQuery, save } from './queryPlanSetup';
import * as azdataGraph from 'azdataGraph/dist/build';
import 'azdataGraph/src/css/common.css';
import 'azdataGraph/src/css/explorer.css';
import './executionPlan.css';
import { Spinner } from '@fluentui/react-components';
import { ExecutionPlanView } from "./executionPlanView";

export const ExecutionPlanPage = () => {
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;
	const [isExecutionPlanLoaded, setIsExecutionPlanLoaded] = useState(false);

	useEffect(() => {
		if (!executionPlanState || isExecutionPlanLoaded) return;
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
		// console.log(mxClient);
		// console.log("Execution Plan State: ", executionPlanState);

		function loadExecutionPlan() {
			if (executionPlanState && executionPlanState.executionPlanGraphs) {
				const executionPlanRootNode = executionPlanState.executionPlanGraphs[0].root;
				const executionPlanView = new ExecutionPlanView(executionPlanRootNode);
				const executionPlanGraph = executionPlanView.populate(executionPlanRootNode);
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

				setIsExecutionPlanLoaded(true);
			}
			else {
				return;
			}
		}
		loadExecutionPlan();

	}, [executionPlanState]);

	const handleSavePlan = async () => {
		await state!.provider.saveExecutionPlan(executionPlanState!.sqlPlanContent!);
	};

	const handleShowXml = async () => {
		await state!.provider.showPlanXml(executionPlanState!.sqlPlanContent!);
	};

	const handleShowQuery = async () => {
		await state!.provider.showQuery(executionPlanState!.query!);
	};

	return (
		<div>
			{executionPlanState && executionPlanState.executionPlanGraphs ? (
				<div id="panelContainer" style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', overflowY: 'auto'}}>
					<div id="planContainer">
						<div>{executionPlanState.query}</div>
						<div id="queryPlanParent" style={{ display: 'flex', alignItems: 'flex-start', overflowX: 'auto', overflowY: 'auto'}}></div>
					</div>
					<div id="iconStack" style={{display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'absolute', opacity: 1, right: 0}}>
						<div id="saveButton" className="button" onClick={handleSavePlan}>
							<img src={save(executionPlanState.theme!)} alt="Save" width="15" height="15" />
						</div>
						<div id="showXmlButton" className="button" onClick={handleShowXml}>
							<img src={openPlanFile(executionPlanState.theme!)} alt="Show Xml" width="15" height="15" />
						</div>
						<div id="showQueryButton" className="button" onClick={handleShowQuery}>
							<img src={openQuery(executionPlanState.theme!)} alt="Show Query" width="15" height="15" />
						</div>
					</div>
				</div>
			) : (
				<Spinner label="Loading..." labelPosition="below" />
			)}
		</div>
	);
};
