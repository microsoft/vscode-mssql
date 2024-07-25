/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Label } from "@fluentui/react-components";

interface Props {
	databasesPath: string;
}

export const FilterHeading = ({ databasesPath }: Props) => {
	return (
		<>
			<Label as="label" size="large">
				<strong>Path:</strong> {databasesPath}
			</Label>
		</>
	);
}
