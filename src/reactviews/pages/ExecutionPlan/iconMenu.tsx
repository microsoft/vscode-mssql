/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import * as utils from './queryPlanSetup';
import './executionPlan.css';
import { makeStyles, Toolbar, ToolbarButton } from '@fluentui/react-components';

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
		height: "100%",
	},
	button: {
		cursor: "pointer"
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
	const LocalizedConstants = executionPlanState!.localizedConstants!;
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
		<Toolbar
		  className={classes.iconStack}
		  style={{
			background: `${utils.background(executionPlanState!.theme!)}`,
		  }}
		  vertical
		>
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.save(executionPlanState!.theme!)}
				alt={LocalizedConstants.savePlan}
			  />
			}
			onClick={handleSavePlan}
			title={LocalizedConstants.savePlan}
			aria-label={LocalizedConstants.savePlan}
		  />
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.openPlanFile(executionPlanState!.theme!)}
				alt={LocalizedConstants.openXml}
			  />
			}
			onClick={handleShowXml}
			title={LocalizedConstants.openXml}
			aria-label={LocalizedConstants.openXml}
		  />
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.openQuery(executionPlanState!.theme!)}
				alt={LocalizedConstants.openQuery}
			  />
			}
			onClick={handleShowQuery}
			title={LocalizedConstants.openQuery}
			aria-label={LocalizedConstants.openQuery}
		  />
		<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState!.theme!)}}></hr>
		<ToolbarButton
			className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.zoomIn(executionPlanState!.theme!)}
				alt={LocalizedConstants.zoomIn}
			  />
			}
			onClick={handleZoomIn}
			title={LocalizedConstants.zoomIn}
			aria-label={LocalizedConstants.zoomIn}
		  />
		  <ToolbarButton
		 	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.zoomOut(executionPlanState!.theme!)}
				alt={LocalizedConstants.zoomOut}
			  />
			}
			onClick={handleZoomOut}
			title={LocalizedConstants.zoomOut}
			aria-label={LocalizedConstants.zoomOut}
		  />
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.zoomToFit(executionPlanState!.theme!)}
				alt={LocalizedConstants.zoomToFit}
			  />
			}
			onClick={handleZoomToFit}
			title={LocalizedConstants.zoomToFit}
			aria-label={LocalizedConstants.zoomToFit}
		  />
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.customZoom(executionPlanState!.theme!)}
				alt={LocalizedConstants.customZoom}
			  />
			}
			onClick={() => setInputContainer(InputEnum.CustomZoom)}
			title={LocalizedConstants.customZoom}
			aria-label={LocalizedConstants.customZoom}
		  />
			<hr className={classes.seperator} style={{background:utils.seperator(executionPlanState!.theme!)}}></hr>
			<ToolbarButton
			className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.search(executionPlanState!.theme!)}
				alt={LocalizedConstants.findNode}
			  />
			}
			onClick={() => setInputContainer(InputEnum.FindNode)}
			title={LocalizedConstants.findNode}
			aria-label={LocalizedConstants.findNode}
		  />
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={utils.highlightOps(executionPlanState!.theme!)}
				alt={LocalizedConstants.highlightOps}
			  />
			}
			onClick={() => setInputContainer(InputEnum.HighlightOps)}
			title={LocalizedConstants.highlightOps}
			aria-label={LocalizedConstants.highlightOps}
			role="button"
		  />
		  <ToolbarButton
		  	className={classes.button}
			tabIndex={0}
			icon={
			  <img
				className={classes.buttonImg}
				src={
				  tooltipsEnabled
					? utils.enableTooltip(executionPlanState!.theme!)
					: utils.disableTooltip(executionPlanState!.theme!)
				}
				alt={LocalizedConstants.toggleTooltips}
			  />
			}
			onClick={handleToggleTooltips}
			title={LocalizedConstants.toggleTooltips}
			aria-label={LocalizedConstants.toggleTooltips}
			role="button"
		  />
		</Toolbar>
	);
};
