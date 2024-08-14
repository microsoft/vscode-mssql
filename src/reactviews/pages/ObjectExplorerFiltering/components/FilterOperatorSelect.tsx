/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Select } from "@fluentui/react-components";
import { NodeFilterPropertyDataType } from "../objectExplorerFilteringInterfaces";

const EQUALS_SELECT_BOX = "Equals";
const NOT_EQUALS_SELECT_BOX = "Not Equals";
const LESS_THAN_SELECT_BOX = "Less Than";
const LESS_THAN_OR_EQUALS_SELECT_BOX = "Less Than Or Equals";
const GREATER_THAN_SELECT_BOX = "Greater Than";
const GREATER_THAN_OR_EQUALS_SELECT_BOX = "Greater Than Or Equals";
const BETWEEN_SELECT_BOX = "Between";
const NOT_BETWEEN_SELECT_BOX = "Not Between";
const CONTAINS_SELECT_BOX = "Contains";
const NOT_CONTAINS_SELECT_BOX = "Not Contains";
const STARTS_WITH_SELECT_BOX = "Starts With";
const NOT_STARTS_WITH_SELECT_BOX = "Not Starts With";
const ENDS_WITH_SELECT_BOX = "Ends With";
const NOT_ENDS_WITH_SELECT_BOX = "Not Ends With";
// const AND_SELECT_BOX = "And";

// strings for value select box for boolean type filters
// const TRUE_SELECT_BOX = "True";
// const FALSE_SELECT_BOX = "False";

const getOperatorsForType = (type: NodeFilterPropertyDataType): string[] => {
	switch (type) {
		case NodeFilterPropertyDataType.String:
			return [
				CONTAINS_SELECT_BOX,
				NOT_CONTAINS_SELECT_BOX,
				EQUALS_SELECT_BOX,
				NOT_EQUALS_SELECT_BOX,
				STARTS_WITH_SELECT_BOX,
				NOT_STARTS_WITH_SELECT_BOX,
				ENDS_WITH_SELECT_BOX,
				NOT_ENDS_WITH_SELECT_BOX,
			];
		case NodeFilterPropertyDataType.Number:
			return [
				EQUALS_SELECT_BOX,
				NOT_EQUALS_SELECT_BOX,
				GREATER_THAN_SELECT_BOX,
				GREATER_THAN_OR_EQUALS_SELECT_BOX,
				LESS_THAN_SELECT_BOX,
				LESS_THAN_OR_EQUALS_SELECT_BOX,
				BETWEEN_SELECT_BOX,
				NOT_BETWEEN_SELECT_BOX
			];
		case NodeFilterPropertyDataType.Boolean:
			return [
				EQUALS_SELECT_BOX,
				NOT_EQUALS_SELECT_BOX
			];
		case NodeFilterPropertyDataType.Choice:
			return [
				EQUALS_SELECT_BOX,
				NOT_EQUALS_SELECT_BOX
			];
		case NodeFilterPropertyDataType.Date:
			return [
				EQUALS_SELECT_BOX,
				NOT_EQUALS_SELECT_BOX,
				GREATER_THAN_SELECT_BOX,
				GREATER_THAN_OR_EQUALS_SELECT_BOX,
				LESS_THAN_SELECT_BOX,
				LESS_THAN_OR_EQUALS_SELECT_BOX,
				BETWEEN_SELECT_BOX,
				NOT_BETWEEN_SELECT_BOX
			];
	}
};

interface Props {
	type: NodeFilterPropertyDataType
}

export const FilterOperatorSelect = ({ type }: Props) => {
	const operators = getOperatorsForType(type);

	return (
		<Select>
			{operators.map((operator, index) => {
				return (
					<option key={index} value={operator}>
						{operator}
					</option>
				);
			})}
		</Select>
	);
};
