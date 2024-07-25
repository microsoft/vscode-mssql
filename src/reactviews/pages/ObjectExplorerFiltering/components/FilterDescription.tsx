/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Label } from "@fluentui/react-components";

interface Props {
	description: string;
}

export const FilterDescription = ({ description }: Props) => {
	return (
		<>
			<Label>
					{description}
			</Label>
		</>
	);
};
