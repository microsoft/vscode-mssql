/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from './queryPlanSetup';
import './executionPlan.css';
import { makeStyles } from '@fluentui/react-components';

const useStyles = makeStyles({
	iconStack: {
		right: 0,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		width: "25px",
		opacity: 1,
		zIndex: "9999",
		position: "absolute",
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
	}
})

interface IconStackProps {
	executionPlanView: any;
	setExecutionPlanView: any;
	setZoomNumber: any;
	setCustomZoomClicked: any;
	setFindNodeClicked: any;
	setHighlightOpsClicked:any;
	query: any;
}

export const IconStack : React.FC<IconStackProps> = ({
	executionPlanView,
	setExecutionPlanView,
	setZoomNumber,
	setCustomZoomClicked,
	setFindNodeClicked,
	setHighlightOpsClicked,
	query
  }) => {
	const classes = useStyles();
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;
	const [tooltipsEnabled, setTooltipsEnabled] = useState(true);
	enum InputEnum {
		CustomZoom,
		FindNode,
		HighlightOps
	}

	const handleSavePlan = async () => {
		await state!.provider.saveExecutionPlan(executionPlanState!.sqlPlanContent!);
	};

	const handleShowXml = async () => {
		await state!.provider.showPlanXml(executionPlanState!.sqlPlanContent!);
	};

	const handleShowQuery = async () => {
		await state!.provider.showQuery(query);
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

	const handleToggleTooltips = async () => {
		if (executionPlanView) {
			executionPlanView.toggleTooltip();
			setExecutionPlanView(executionPlanView);
			setTooltipsEnabled(!tooltipsEnabled);
		}
	};

	const setInputContainer = (inputType: InputEnum) => {
		if (inputType == InputEnum.CustomZoom) {
			setFindNodeClicked(false);
			setHighlightOpsClicked(false);
			setCustomZoomClicked(true);
		}
		else if (inputType == InputEnum.FindNode) {
			setFindNodeClicked(true);
			setHighlightOpsClicked(false);
			setCustomZoomClicked(false);
		}
		else {
			setFindNodeClicked(false);
			setHighlightOpsClicked(true);
			setCustomZoomClicked(false);
		}
	}

	return (
		<div id="iconStack" className={classes.iconStack} style={{outline: `2px solid ${utils.seperator(executionPlanState!.theme!)}`, background:`${utils.background(executionPlanState!.theme!)}`}}>
			<div id="saveButton" className={classes.button} onClick={handleSavePlan} >
				<img className={classes.buttonImg} src={utils.save(executionPlanState!.theme!)} alt="Save" width="20" height="20" />
			</div>
			<div id="showXmlButton" className={classes.button} onClick={handleShowXml} >
				<img className={classes.buttonImg} src={utils.openPlanFile(executionPlanState!.theme!)} alt="Show Xml" width="20" height="20" />
			</div>
			<div id="showQueryButton" className={classes.button} onClick={handleShowQuery} >
				<img className={classes.buttonImg} src={utils.openQuery(executionPlanState!.theme!)} alt="Show Query" width="20" height="20" />
			</div>
			<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState!.theme!)}}></hr>
			<div id="zoomInButton" className={classes.button} onClick={handleZoomIn} >
				<img className={classes.buttonImg} src={utils.zoomIn(executionPlanState!.theme!)} alt="Zoom In" width="20" height="20" />
			</div>
			<div id="zoomOutButton" className={classes.button} onClick={handleZoomOut} >
				<img className={classes.buttonImg} src={utils.zoomOut(executionPlanState!.theme!)} alt="Zoom Out" width="20" height="20" />
			</div>
			<div id="zoomToFitButton" className={classes.button} onClick={handleZoomToFit} >
				<img className={classes.buttonImg} src={utils.zoomToFit(executionPlanState!.theme!)} alt="Zoom To Fit" width="20" height="20" />
			</div>
			<div id="customZoomButton" className={classes.button} onClick={() => setInputContainer(InputEnum.CustomZoom)} >
				<img className={classes.buttonImg} src={utils.customZoom(executionPlanState!.theme!)} alt="Custom Zoom" width="20" height="20" />
			</div>
			<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState!.theme!)}}></hr>
			<div id="findNodeButton" className={classes.button} onClick={() => setInputContainer(InputEnum.FindNode)} >
				<img className={classes.buttonImg} src={utils.search(executionPlanState!.theme!)} alt="Find Node" width="20" height="20" />
			</div>
			<div id="highlightOpsButton" className={classes.button} onClick={() => setInputContainer(InputEnum.HighlightOps)} >
				<img className={classes.buttonImg} src={utils.highlightOps(executionPlanState!.theme!)} alt="Highlight Expensive Ops" width="20" height="20" />
			</div>
			<div id="tooltipsButton" className={classes.button} onClick={handleToggleTooltips} >
			{tooltipsEnabled ? (
					<img className={classes.buttonImg} src={utils.enableTooltip(executionPlanState!.theme!)} alt="Tooltips Enabled" width="20" height="20" />
				):
					<img className={classes.buttonImg} src={utils.disableTooltip(executionPlanState!.theme!)} alt="Tooltips Disabled" width="20" height="20" />
				}
			</div>
		</div>
	);
};
