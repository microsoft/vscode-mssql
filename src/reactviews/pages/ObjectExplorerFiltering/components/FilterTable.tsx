/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Table, TableBody, TableCell, TableHeader, TableHeaderCell, TableRow } from "@fluentui/react-components";
import { Filter } from "../objectExplorerFilteringInterfaces";
import { Eraser20Regular } from "@fluentui/react-icons";
import { useState } from "react";

interface TableHeaderColumn {
	id: number;
	name: string;
}

interface Props {
	filterData: Array<Filter>;
	onSelectedFilter: (description: string) => void;
}

export const FilterTable = ({ filterData, onSelectedFilter }: Props) => {
	const [filters, setFilters] = useState(filterData);

	const updateFilterValue = (filter: Filter, filterIndex: number, newValue: string) => {
		const updatedFilter: Filter = {filterName: filter.filterName, operator: filter.operator, value: newValue, filterDescription: filter.filterDescription};
		setFilters(filters.map((f, i) => (filterIndex == i ? updatedFilter : f)));
	};

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
									<Input as="input" value={filter.value} onChange={(_, newValue) => updateFilterValue(filter, index, newValue.value)} />
								</TableCell>
								<TableCell>
									<Button icon={<Eraser20Regular />} aria-label="Clear" onClick={() => updateFilterValue(filter, index, '')} />
								</TableCell>
							</TableRow>
						)
					})}
				</TableBody>
			</Table>
		</>
	);
}
