/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { getBadgePaths, getCollapseExpandPaths, getIconPaths, openPlanFile, openQuery, save, background } from './queryPlanSetup';
import * as azdataGraph from 'azdataGraph/dist/build';
import 'azdataGraph/src/css/common.css';
import 'azdataGraph/src/css/explorer.css';
import './executionPlan.css';
import { makeStyles, Spinner } from '@fluentui/react-components';
import { ExecutionPlanView } from "./executionPlanView";

const useStyles = makeStyles({
	outerDiv: {
		height: "100%",
		width: "100%",
		overflow: "auto"
	},
	panelContainer: {
		display: "flex",
		flexDirection: "row",
		height: "100%",
		width: "100%",
	},
	planContainer: {
		flexGrow: 1,
		width: "100%",
		height: "100%"
	},
	queryCostContainer: {
		opacity: 1,
		padding: "5px"
	},
	queryPlanParent: {
		width: "100%",
		height: "100%",
	},
	iconStack: {
		display: "flex",
		flexDirection: "column",
		justifyContent: "flex-start",
		alignItems: "center",
		position: "fixed",
		top: 0,
		right: 0,
		width: "25px",
		height: "100%",
		opacity: 1
	},
	button: {
		cursor: "pointer",
		marginBottom: "10px"
	},
	buttonImg: {
		display: "block"
	}
})

export const ExecutionPlanPage = () => {
	const classes = useStyles();
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
		<div className={classes.outerDiv}>
			{executionPlanState && executionPlanState.executionPlanGraphs ? (
				<div id="panelContainer" className={classes.panelContainer}>
					<div id="planContainer" className={classes.planContainer}>
						<div id="queryCostContainer" className={classes.queryCostContainer} style={{background:background(executionPlanState.theme!)}}>{executionPlanState.query}</div>
						<div id="queryPlanParent" className={classes.queryPlanParent}></div>
					</div>
					<div id="iconStack" className={classes.iconStack} style={{background:background(executionPlanState.theme!)}}>
						<div id="saveButton" className={classes.button} onClick={handleSavePlan}>
							<img className={classes.buttonImg} src={save(executionPlanState.theme!)} alt="Save" width="20" height="20" />
						</div>
						<div id="showXmlButton" className={classes.button} onClick={handleShowXml}>
							<img className={classes.buttonImg} src={openPlanFile(executionPlanState.theme!)} alt="Show Xml" width="20" height="20" />
						</div>
						<div id="showQueryButton" className={classes.button} onClick={handleShowQuery}>
							<img className={classes.buttonImg} src={openQuery(executionPlanState.theme!)} alt="Show Query" width="20" height="20" />
						</div>
					</div>
				</div>
			) : (
				<Spinner label="Loading..." labelPosition="below" />
			)}
		</div>
	);
};
