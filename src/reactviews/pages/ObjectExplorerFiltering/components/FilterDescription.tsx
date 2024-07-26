/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Label, makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
	description: {
		height: '50px',
		border: '1px solid',
		padding: '5px'
	}
});

interface Props {
	description: string;
}

export const FilterDescription = ({ description }: Props) => {
	const classes = useStyles();

	return (
		<>
			<div className={classes.description}>
				<Label>
						{description}
				</Label>
			</div>
		</>
	);
};
