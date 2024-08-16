/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { makeStyles, Spinner } from '@fluentui/react-components';
import { ExecutionPlanGraph } from './executionPlanGraph';

const useStyles = makeStyles({
	outerDiv: {
		height: "100%",
		width: "100%",
		position: "relative",
		overflowY: "auto"
	}
})

export const ExecutionPlanPage = () => {
	const classes = useStyles();
	const state = useContext(ExecutionPlanContext);
	const executionPlanState = state?.state;

	return (
		<div className={classes.outerDiv}>
			{executionPlanState && !executionPlanState.isLoading && executionPlanState.executionPlanGraphs ? (
				executionPlanState.executionPlanGraphs.map((_, index) => (
					<ExecutionPlanGraph key={index} graphIndex={index} />
				))
			) : (
				<Spinner label="Loading..." labelPosition="below" />
			)}
		</div>
	);
};
