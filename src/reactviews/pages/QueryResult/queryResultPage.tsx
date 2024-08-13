/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, shorthands } from "@fluentui/react-components";
import { useContext } from "react";
import { QueryResultContext } from "./queryResultStateProvider";
// import { ResizableBox } from "react-resizable";
import { QueryResultPane } from "./queryResultPane";

const useStyles = makeStyles({
	root: {
		display: 'flex',
		flexDirection: 'column',
		height: '100%',
		width: '100%',
		maxWidth: '100%',
		maxHeight: '100%',
	},
	pageContext: {
		display: 'flex',
		justifyContent: 'center',
		alignItems: 'center',
		height: '100%',
		width: '100%',
		flexDirection: 'column'
	},
	errorIcon: {
		fontSize: '100px',
		opacity: 0.5
	},
	retryButton: {
		marginTop: '10px'
	},
	resultPaneHandle: {
		position: 'absolute',
		top: '0',
		right: '0',
		width: '100%',
		height: '10px',
		cursor: 'ns-resize',
		zIndex: 1,
		boxShadow: '0px -1px 1px  #e0e0e0'
	},
	propertiesPaneHandle: {
		position: 'absolute',
		top: '0',
		left: '0',
		width: '10px',
		height: '100%',
		cursor: 'ew-resize',
		zIndex: 1,
		// boxShadow: '0px -1px 1px  #e0e0e0'
	},
	designerRibbon: {
		width: '100%'
	},
	mainContent: {
		height: '100%',
		width: '100%',
		minHeight: '100%',
		display: 'flex',
		...shorthands.flex(1),
		flexDirection: 'column',
		...shorthands.overflow('hidden'),
	},
	editor: {
		...shorthands.overflow('hidden'),
		...shorthands.flex(1),
		width: '100%',
		display: 'flex',
		flexDirection: 'row',
	},
	resultPaneContainer: {
		width: '100%',
		position: 'relative',
	},
	mainPaneContainer: {
		...shorthands.flex(1),
		height: '100%',
		...shorthands.overflow('hidden'),
	},
	propertiesPaneContainer: {
		position: 'relative',
		height: '100%',
		width: '300px',
		...shorthands.overflow('hidden'),
	}
});

export const QueryResult = () => {
	const classes = useStyles();
	const state = useContext(QueryResultContext);
	const queryResultState = state?.state;
	if (!queryResultState) {
		return null;
	}
	return (
		<div className={classes.root}>
			{
				<div className={classes.mainContent}>
                        <QueryResultPane />
                </div>
			}
		</div >
	);
}

