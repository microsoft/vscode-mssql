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
import { Button, Dropdown, Input, Option, makeStyles, Spinner } from '@fluentui/react-components';
import { ExecutionPlanView } from "./executionPlanView";
import { ArrowUp20Regular, ArrowDown20Regular, Checkmark20Regular, Dismiss20Regular } from '@fluentui/react-icons';
import * as ep from './executionPlanInterfaces';

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
	inputContainer: {
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
		opacity: 1
	},
	queryCostContainer: {
		opacity: 1,
		padding: "5px",
		width: "100%"
	},
	queryPlanParent: {
		opacity: 1,
		width: "100%",
		height: "100%",
		overflowX: 'auto',
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
		height: "100%"
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
	},
	dropdown: {
		maxHeight: "200px"
	}
})

export const ExecutionPlanPage = () => {
	const classes = useStyles();
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;
	const [isExecutionPlanLoaded, setIsExecutionPlanLoaded] = useState(false);
	const [executionPlanView, setExecutionPlanView] = useState<ExecutionPlanView | null>(null);
	const [zoomNumber, setZoomNumber] = useState(100);
	const [customZoomClicked, setCustomZoomClicked] = useState(false);
	const [findNodeClicked, setFindNodeClicked] = useState(false);
	const [findNodeOptions, setFindNodeOptions] = useState<string[]>([]);
	const findNodeComparisonOptions = ["Equals","Contains",">","<",">=","<=","<>"];
	const findNodeEnumMap: {
		[key: string]: ep.SearchType;
	  } = {
		"Equals": ep.SearchType.Equals,
		"Contains": ep.SearchType.Contains,
		">": ep.SearchType.GreaterThan,
		"<": ep.SearchType.LesserThan,
		">=": ep.SearchType.GreaterThanEqualTo,
		"<=": ep.SearchType.LesserThanEqualTo,
		"<>": ep.SearchType.LesserAndGreaterThan
	};
	const [findNodeSelection, setFindNodeSelection] = useState('');
	const [findNodeComparisonSelection, setFindNodeComparisonSelection] = useState('');
	const [findNodeSearchValue, setFindNodeSearchValue] = useState('');
	const [findNodeResults, setFindNodeResults] = useState<ep.ExecutionPlanNode[]>([]);
	const [findNodeResultsIndex, setFindNodeResultsIndex] = useState(-1);

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
				setFindNodeOptions(executionPlanView.getUniqueElementProperties());
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

	const handlePreviousFoundNode = async () => {
		if (executionPlanView) {
			if (findNodeResultsIndex === -1 && executionPlanView) {
				let searchQuery: ep.SearchQuery = {
					propertyName: findNodeSelection,
					value: findNodeSearchValue,
					searchType: findNodeEnumMap[findNodeComparisonSelection]
				}

				setFindNodeResults(executionPlanView.searchNodes(searchQuery));
				setFindNodeResultsIndex(0);
			}
			else if (findNodeResultsIndex === 0) {
				setFindNodeResultsIndex(findNodeResults.length - 1);
			}
			else {
				setFindNodeResultsIndex(findNodeResultsIndex-1);
			}
			executionPlanView.selectElement(findNodeResults[findNodeResultsIndex], true);
			setExecutionPlanView(executionPlanView);
		}
	};

	const handleNextFoundNode = async () => {
		if (executionPlanView) {
			if (findNodeResultsIndex === -1) {
				let searchQuery: ep.SearchQuery = {
					propertyName: findNodeSelection,
					value: findNodeSearchValue,
					searchType: findNodeEnumMap[findNodeComparisonSelection]
				}

				setFindNodeResults(executionPlanView.searchNodes(searchQuery));
				setFindNodeResultsIndex(0);
			}
			else if (findNodeResultsIndex === findNodeResults.length - 1) {
				setFindNodeResultsIndex(0);
			}
			else {
				setFindNodeResultsIndex(findNodeResultsIndex+1);
			}
			executionPlanView.selectElement(findNodeResults[findNodeResultsIndex], true);
			setExecutionPlanView(executionPlanView);
		}
	};

	return (
		<div className={classes.outerDiv}>
			{executionPlanState && executionPlanState.executionPlanGraphs ? (
				<div id="panelContainer" className={classes.panelContainer}>
					<div id="planContainer" className={classes.planContainer}>
						<div id="queryCostContainer" className={classes.queryCostContainer} style={executionPlanState.theme === "light" ? { background: "#F2F2F2" } : {}}>{executionPlanState.query}</div>
						<div id="queryPlanParent" className={classes.queryPlanParent} ></div>
						{customZoomClicked ? (
							<div id="customZoomInputContainer" className={classes.inputContainer} style={{background:utils.iconBackground(executionPlanState.theme!)}}>
								<Input id="customZoomInputBox" type="number" min={1} defaultValue={Math.floor(zoomNumber).toString()} onChange={(e) => setZoomNumber(Number(e.target.value))} style={{ width: '100px', height: '25px', fontSize: '12px' }}/>
								<Button onClick={handleCustomZoomInput} icon={<Checkmark20Regular />} />
								<Button icon={<Dismiss20Regular />} onClick={() => setCustomZoomClicked(false)}/>
							</div>
						) : null}
						{findNodeClicked ? (
							<div id="findNodeInputContainer" className={classes.inputContainer} style={{background:utils.iconBackground(executionPlanState.theme!)}}>
								<div>Find Nodes</div>
								<Dropdown id="findNodeDropdown" onOptionSelect={(_, data) => {setFindNodeSelection(data.optionText ?? ''); setFindNodeResultsIndex(-1)}}>
									<div style={{maxHeight:"250px"}}>
									{findNodeOptions.map((option) => (
										<Option key={option}>
											{option}
										</Option>
									))}
									</div>
								</Dropdown>
								<Dropdown id="findNodeComparisonDropdown" className={classes.dropdown} onOptionSelect={(_, data) => {setFindNodeComparisonSelection(data.optionText ?? ''); setFindNodeResultsIndex(-1)}}>
									{findNodeComparisonOptions.map((option) => (
										<Option key={option}>
											{option}
										</Option>
									))}
								</Dropdown>
								<Input id="findNodeInputBox" type="text"  onChange={(e) => {setFindNodeSearchValue(e.target.value); setFindNodeResultsIndex(-1)}}/>
								<Button onClick={handlePreviousFoundNode} icon={<ArrowUp20Regular />} />
								<Button onClick={handleNextFoundNode} icon={<ArrowDown20Regular />} />
								<Button icon={<Dismiss20Regular />} onClick={() => setFindNodeClicked(false)}/>
							</div>
						) : null}
					</div>
					<div id="iconStack" className={classes.iconStack} style={{background:utils.iconBackground(executionPlanState.theme!)}}>
						<div id="saveButton" className={classes.button} onClick={handleSavePlan} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.save(executionPlanState.theme!)} alt="Save" width="20" height="20" />
						</div>
						<div id="showXmlButton" className={classes.button} onClick={handleShowXml} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.openPlanFile(executionPlanState.theme!)} alt="Show Xml" width="20" height="20" />
						</div>
						<div id="showQueryButton" className={classes.button} onClick={handleShowQuery} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.openQuery(executionPlanState.theme!)} alt="Show Query" width="20" height="20" />
						</div>
						<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState.theme!)}}></hr>
						<div id="zoomInButton" className={classes.button} onClick={handleZoomIn} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.zoomIn(executionPlanState.theme!)} alt="Zoom In" width="20" height="20" />
						</div>
						<div id="zoomOutButton" className={classes.button} onClick={handleZoomOut} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.zoomOut(executionPlanState.theme!)} alt="Zoom Out" width="20" height="20" />
						</div>
						<div id="zoomToFitButton" className={classes.button} onClick={handleZoomToFit} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.zoomToFit(executionPlanState.theme!)} alt="Zoom To Fit" width="20" height="20" />
						</div>
						<div id="customZoomButton" className={classes.button} onClick={() => setCustomZoomClicked(true)} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.customZoom(executionPlanState.theme!)} alt="Custom Zoom" width="20" height="20" />
						</div>
						<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState.theme!)}}></hr>
						<div id="findNodeButton" className={classes.button} onClick={() => setFindNodeClicked(true)} style={{background:utils.background(executionPlanState.theme!)}}>
							<img className={classes.buttonImg} src={utils.search(executionPlanState.theme!)} alt="Find Node" width="20" height="20" />
						</div>
					</div>
				</div>
			) : (
				<Spinner label="Loading..." labelPosition="below" />
			)}
		</div>
	);
};
