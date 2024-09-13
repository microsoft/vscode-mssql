/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from './queryPlanSetup';
import './executionPlan.css';
import { makeStyles } from '@fluentui/react-components';
import { locConstants } from '../../common/locConstants';

const useStyles = makeStyles({
	iconStack: {
		right: 0,
		display: "flex",
		flexDirection: "column",
		alignItems: "center",
		width: "25px",
		opacity: 1,
		zIndex: "1",
		position: "absolute",
		height: "100%"
	},
	button: {
		cursor: "pointer",
		marginTop: "5px",
		marginBottom: "5px",
	},
	buttonImg: {
		display: "block",
		height: "16px",
		width: "16px"
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

	const SAVE_PLAN = locConstants.executionPlan.savePlan;
	const OPEN_XML = locConstants.executionPlan.openXml;
	const OPEN_QUERY = locConstants.executionPlan.openQuery;
	const ZOOM_IN = locConstants.executionPlan.zoomIn;
	const ZOOM_OUT = locConstants.executionPlan.zoomOut;
	const ZOOM_TO_FIT = locConstants.executionPlan.zoomToFit;
	const CUSTOM_ZOOM = locConstants.executionPlan.customZoom;
	const FIND_NODE = locConstants.executionPlan.findNode;
	const HIGHLIGHT_OPS = locConstants.executionPlan.highlightExpensiveOperation;
	const TOGGLE_TOOLTIPS = locConstants.executionPlan.toggleTooltips;

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
			<div id="saveButton" className={classes.button} onClick={handleSavePlan} tabIndex={0} title={SAVE_PLAN} aria-label={SAVE_PLAN}>
				<img className={classes.buttonImg} src={utils.save(executionPlanState!.theme!)} alt={SAVE_PLAN} width="20" height="20" />
			</div>
			<div id="showXmlButton" className={classes.button} onClick={handleShowXml} tabIndex={0} title={OPEN_XML} aria-label={OPEN_XML}>
				<img className={classes.buttonImg} src={utils.openPlanFile(executionPlanState!.theme!)} alt={OPEN_XML} width="20" height="20" />
			</div>
			<div id="showQueryButton" className={classes.button} onClick={handleShowQuery} tabIndex={0} title={OPEN_QUERY} aria-label={OPEN_QUERY}>
				<img className={classes.buttonImg} src={utils.openQuery(executionPlanState!.theme!)} alt={OPEN_QUERY}width="20" height="20" />
			</div>
			<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState!.theme!)}}></hr>
			<div id="zoomInButton" className={classes.button} onClick={handleZoomIn} tabIndex={0} title={ZOOM_IN} aria-label={ZOOM_IN}>
				<img className={classes.buttonImg} src={utils.zoomIn(executionPlanState!.theme!)} alt={ZOOM_IN} width="20" height="20" />
			</div>
			<div id="zoomOutButton" className={classes.button} onClick={handleZoomOut} tabIndex={0} title={ZOOM_OUT} aria-label={ZOOM_OUT}>
				<img className={classes.buttonImg} src={utils.zoomOut(executionPlanState!.theme!)} alt={ZOOM_OUT} width="20" height="20" />
			</div>
			<div id="zoomToFitButton" className={classes.button} onClick={handleZoomToFit} tabIndex={0} title={ZOOM_TO_FIT} aria-label={ZOOM_TO_FIT}>
				<img className={classes.buttonImg} src={utils.zoomToFit(executionPlanState!.theme!)} alt={ZOOM_TO_FIT} width="20" height="20" />
			</div>
			<div id="customZoomButton" className={classes.button} onClick={() => setInputContainer(InputEnum.CustomZoom)} tabIndex={0} title={CUSTOM_ZOOM} aria-label={CUSTOM_ZOOM}>
				<img className={classes.buttonImg} src={utils.customZoom(executionPlanState!.theme!)} alt={CUSTOM_ZOOM} width="20" height="20" />
			</div>
			<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState!.theme!)}}></hr>
			<div id="findNodeButton" className={classes.button} onClick={() => setInputContainer(InputEnum.FindNode)} tabIndex={0} title={FIND_NODE} aria-label={FIND_NODE}>
				<img className={classes.buttonImg} src={utils.search(executionPlanState!.theme!)} alt={FIND_NODE} width="20" height="20" />
			</div>
			<div id="highlightOpsButton" className={classes.button} onClick={() => setInputContainer(InputEnum.HighlightOps)} tabIndex={0} title={HIGHLIGHT_OPS} aria-label={HIGHLIGHT_OPS}>
				<img className={classes.buttonImg} src={utils.highlightOps(executionPlanState!.theme!)} alt={HIGHLIGHT_OPS} width="20" height="20" />
			</div>
			<div id="tooltipsButton" className={classes.button} onClick={handleToggleTooltips} tabIndex={0} title={TOGGLE_TOOLTIPS}  aria-label={TOGGLE_TOOLTIPS}>
			{tooltipsEnabled ? (
					<img className={classes.buttonImg} src={utils.enableTooltip(executionPlanState!.theme!)} alt={TOGGLE_TOOLTIPS} width="20" height="20" />
				):
					<img className={classes.buttonImg} src={utils.disableTooltip(executionPlanState!.theme!)} alt={TOGGLE_TOOLTIPS} width="20" height="20" />
				}
			</div>
		</div>
	);
};
