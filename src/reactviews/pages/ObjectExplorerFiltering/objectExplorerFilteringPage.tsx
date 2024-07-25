/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FilterHeading } from "./components/FilterHeading";
import { FilterTable } from "./components/FilterTable";
import { FilterDescription } from "./components/FilterDescription";
import { Filter } from "./objectExplorerFilteringInterfaces";
import { useState } from "react";

export const ObjectExplorerFiltering = () => {
	const filters: Array<Filter> = [
		{
			filterName: 'Name',
			operator: 'Contains',
			value: 'Fizz',
			filterDescription: 'Include or exclude object based on the name or part of a name.',
		},
		{
			filterName: 'Owner',
			operator: 'Contains',
			value: 'Buzz',
			filterDescription: 'Include or exclude objects based on the owner or part of an owner name.',
		},
		{
			filterName: 'Create Date',
			operator: 'Equals',
			value: 'FooBar',
			filterDescription: 'Include or exclude objects based on their creation date.',
		},
	];
	let initialDescripion = filters[0].filterDescription;

	const [filterDescription, setFilterDescription] = useState<string>(initialDescripion);

	const handleSelectedFilter = (description: string) => {
		setFilterDescription(description);
	};

	let path = '(localdb)\\MSSqlLocalDb/Databases';

	return (
		<>
			<FilterHeading databasesPath={path}/>
			<FilterTable filters={filters} onSelectedFilter={handleSelectedFilter} />
			<FilterDescription description={filterDescription} />
		</>
	);
}
