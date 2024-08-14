/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from './queryPlanSetup';
import * as azdataGraph from 'azdataGraph/dist/build';
import 'azdataGraph/src/css/common.css';
import 'azdataGraph/src/css/explorer.css';
import './executionPlan.css';
import { Button, Input, makeStyles, Spinner } from '@fluentui/react-components';
import { ExecutionPlanView } from "./executionPlanView";
import { Checkmark20Regular, Dismiss20Regular } from '@fluentui/react-icons';

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
	customZoomInputContainer: {
		position: "absolute",
		top: 0,
		right: "35px",
		padding: "10px",
		border: "1px solid #ccc",
		zIndex: "100",
		boxShadow: "0px 4px 6px rgba(0, 0, 0, 0.1)",
		display: "flex",
		alignItems: "center",
		gap: "2px",
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
		marginTop: "5px",
		marginBottom: "5px"
	},
	buttonImg: {
		display: "block"
	},
	seperator: {
		width: "100%",
		height: "2px",
		border: "none"
	}
})

export const ExecutionPlanPage = () => {
	const classes = useStyles();
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;
	const [isExecutionPlanLoaded, setIsExecutionPlanLoaded] = useState(false);
	const [executionPlanView, setExecutionPlanView] = useState<ExecutionPlanView | null>(null);
	const [customZoomClicked, setCustomZoomClicked] = useState(false);
	const [zoomNumber, setZoomNumber] = useState(100);

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
		console.log("Execution Plan State: ", executionPlanState);

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
					iconPaths: utils.getIconPaths(),
					badgeIconPaths: utils.getBadgePaths(),
					expandCollapsePaths: utils.getCollapseExpandPaths(),
					showTooltipOnClick: true
				};
				const pen = new mxClient.azdataQueryPlan(queryPlanConfiguration);
				pen.setTextFontColor('var(--vscode-editor-foreground)'); // set text color
				pen.setEdgeColor('var(--vscode-editor-foreground)'); // set edge color

				executionPlanView.setDiagram(pen);

				setExecutionPlanView(executionPlanView);
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

	const handleZoomIn = async () => {
		if (executionPlanView) {
			executionPlanView.zoomIn();
			setExecutionPlanView(executionPlanView);
			setZoomNumber(executionPlanView.getZoomLevel());
		}
	};

	const handleZoomOut = async () => {
		if (executionPlanView) {
			executionPlanView.zoomOut();
			setExecutionPlanView(executionPlanView);
			setZoomNumber(executionPlanView.getZoomLevel());
		}
	};

	const handleZoomToFit = async () => {
		if (executionPlanView) {
			executionPlanView.zoomToFit();
			setExecutionPlanView(executionPlanView);
			setZoomNumber(executionPlanView.getZoomLevel());
		}
	};

	const handleCustomZoomInput = async () => {
		if (executionPlanView) {
			executionPlanView.setZoomLevel(zoomNumber);
			setExecutionPlanView(executionPlanView);
			setZoomNumber(executionPlanView.getZoomLevel());
		}
		setCustomZoomClicked(false);
	};

	return (
		<div className={classes.outerDiv}>
			{executionPlanState && executionPlanState.executionPlanGraphs ? (
				<div id="panelContainer" className={classes.panelContainer}>
					<div id="planContainer" className={classes.planContainer}>
						<div id="queryCostContainer" className={classes.queryCostContainer} style={{background:utils.background(executionPlanState.theme!)}}>{executionPlanState.query}</div>
						<div id="queryPlanParent" className={classes.queryPlanParent}></div>
						{customZoomClicked ? (
							<div id="customZoomInputContainer" className={classes.customZoomInputContainer} style={{background:utils.background(executionPlanState.theme!)}}>
								<Input id="customZoomInputBox" type="number" min={1} defaultValue={zoomNumber.toString()} onChange={(e) => setZoomNumber(Number(e.target.value))} style={{ width: '100px', height: '25px', fontSize: '12px' }}/>
								<Button onClick={handleCustomZoomInput} icon={<Checkmark20Regular />} />
								<Button icon={<Dismiss20Regular />} onClick={() => setCustomZoomClicked(false)}/>
							</div>
						) : null}
					</div>
					<div id="iconStack" className={classes.iconStack} style={{background:utils.background(executionPlanState.theme!)}}>
						<div id="saveButton" className={classes.button} onClick={handleSavePlan}>
							<img className={classes.buttonImg} src={utils.save(executionPlanState.theme!)} alt="Save" width="20" height="20" />
						</div>
						<div id="showXmlButton" className={classes.button} onClick={handleShowXml}>
							<img className={classes.buttonImg} src={utils.openPlanFile(executionPlanState.theme!)} alt="Show Xml" width="20" height="20" />
						</div>
						<div id="showQueryButton" className={classes.button} onClick={handleShowQuery}>
							<img className={classes.buttonImg} src={utils.openQuery(executionPlanState.theme!)} alt="Show Query" width="20" height="20" />
						</div>
						<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState.theme!)}}></hr>
						<div id="zoomInButton" className={classes.button} onClick={handleZoomIn}>
							<img className={classes.buttonImg} src={utils.zoomIn(executionPlanState.theme!)} alt="Zoom In" width="20" height="20" />
						</div>
						<div id="zoomOutButton" className={classes.button} onClick={handleZoomOut}>
							<img className={classes.buttonImg} src={utils.zoomOut(executionPlanState.theme!)} alt="Zoom Out" width="20" height="20" />
						</div>
						<div id="zoomToFitButton" className={classes.button} onClick={handleZoomToFit}>
							<img className={classes.buttonImg} src={utils.zoomToFit(executionPlanState.theme!)} alt="Zoom To Fit" width="20" height="20" />
						</div>
						<div id="customZoomButton" className={classes.button} onClick={() => setCustomZoomClicked(true)}>
							<img className={classes.buttonImg} src={utils.customZoom(executionPlanState.theme!)} alt="Custom Zoom" width="20" height="20" />
						</div>
					</div>
				</div>
			) : (
				<Spinner label="Loading..." labelPosition="below" />
			)}
		</div>
	);
};
