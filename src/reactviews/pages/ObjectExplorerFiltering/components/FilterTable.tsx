/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@fluentui/react-components";
import { Filter } from "../objectExplorerFilteringInterfaces";
import { Eraser20Regular } from "@fluentui/react-icons";

interface TableHeaderColumn {
	id: number;
	name: string;
}

interface Props {
	filters: Array<Filter>;
	onSelectedFilter: (description: string) => void;
	onFilterValueChange: (filter: Filter, filterIndex: number, newValue: string) => void;
}

export const FilterTable = ({ filters, onSelectedFilter, onFilterValueChange }: Props) => {
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
							<TableHeaderCell key={`header-col-${column.id}`}>
								{column.name}
							</TableHeaderCell>
						)}
					</TableRow>
				</TableHeader>
				<TableBody>
					{filters.map((filter, index) => {
						return (
							<TableRow
								key={`row-${index}`}
								onClick={() => onSelectedFilter(filter.filterDescription)}
							>
								<TableCell>
									{filter.filterName}
								</TableCell>
								<TableCell>
									{filter.operator}
								</TableCell>
								<TableCell>
									<Input
										as="input"
										value={filter.value}
										onChange={(_, newValue) => onFilterValueChange(filter, index, newValue.value)} />
								</TableCell>
								<TableCell>
									<Button
										icon={<Eraser20Regular />}
										aria-label="Clear"
										onClick={() => onFilterValueChange(filter, index, '')} />
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</>
	);
}
