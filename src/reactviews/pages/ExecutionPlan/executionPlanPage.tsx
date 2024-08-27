/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from 'react';
import { ExecutionPlanContext } from "./executionPlanStateProvider";
import { makeStyles, Spinner } from '@fluentui/react-components';
import { ExecutionPlanGraph } from './executionPlanGraph';

const useStyles = makeStyles({
	outerDiv: {
		height: "100%",
		width: "100%",
		position: "relative",
		overflowY: "auto"
	},
	spinnerDiv: {
		height: "100%",
		width: "100%",
		display: "flex",
		justifyContent: "center",
		alignItems: "center"
	}
})

export const ExecutionPlanPage = () => {
	const classes = useStyles();
	const state = useContext(ExecutionPlanContext);
	const [executionPlanState, setExecutionPlanState] = useState(state?.state);

	useEffect(() => {
		function checkIfStateIsLoaded() {
			if (!executionPlanState && state?.state) {
			  setExecutionPlanState(state.state);
			}
		}

		// Check every 200 milliseconds
		const intervalId = setInterval(checkIfStateIsLoaded, 200);

		return () => clearInterval(intervalId);
	  }, [executionPlanState, state]);

	return (
		<div className={classes.outerDiv}>
			{executionPlanState && !executionPlanState.isLoading && executionPlanState.executionPlanGraphs ? (
				executionPlanState.executionPlanGraphs.map((_, index) => (
					<ExecutionPlanGraph key={index} graphIndex={index} />
				))
			) : (
				// localize this
				<div className={classes.spinnerDiv}>
					<Spinner label="Loading..." labelPosition="below" />
				</div>
			)}
		</div>
	);
};
