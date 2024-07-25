/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Label, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@fluentui/react-components";
import { Filter } from "../objectExplorerFilteringInterfaces";

interface TableHeaderColumn {
	id: number;
	name: string;
}

interface Props {
	filters: Array<Filter>;
	onSelectedFilter: (description: string) => void;
}

export const FilterTable = ({ filters, onSelectedFilter }: Props) => {
	const tableHeaderColumns: Array<TableHeaderColumn> = [
		{
			id: 1,
			name: 'Property'
		},
		{
			id: 2,
			name: 'Operator'
		},
		{
			id: 3,
			name: 'Value'
		},
		{
			id: 4,
			name: 'Clear'
		}
	];

	return (
		<>
			<Table
				as="table"
				size="small"
			>
				<TableHeader>
					<TableRow>
						{tableHeaderColumns.map((column: TableHeaderColumn) =>
							<TableHeaderCell key={column.id}>
								{column.name}
							</TableHeaderCell>
						)}
					</TableRow>
				</TableHeader>
				<TableBody>
					{filters.map((filterRow) => {
						return (
							<TableRow onClick={() => onSelectedFilter(filterRow.filterDescription)}>
								<TableCell>
									{filterRow.filterName}
								</TableCell>
								<TableCell>
									{filterRow.operator}
								</TableCell>
								<TableCell>
									{filterRow.value}
								</TableCell>
								<TableCell>
									<Label>Clear</Label>
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</>
	);
}
