/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FilterHeading } from "./components/FilterHeading";
import { FilterTable } from "./components/FilterTable";
import { FilterDescription } from "./components/FilterDescription";
import { NodeFilterProperty } from "./objectExplorerFilteringInterfaces";
import { useContext, useState } from "react";
import { Button } from "@fluentui/react-components";
import { ObjectExplorerFilteringContext } from "./objectExplorerFilteringProvider";

export const ObjectExplorerFiltering = () => {
	debugger;
	const { state } = useContext(ObjectExplorerFilteringContext);

	if (!state?.filterableProperties) {
		return null;
	}

	const [filterableProperties, setFilters] = useState(state.filterableProperties);
	let initialDescripion = filterableProperties[0].description;

	const [filterablePropertyDescription, setFilterDescription] = useState<string>(initialDescripion);

	const updateFilterDescription = (description: string) => {
		setFilterDescription(description);
	};

	const updateFilterValue = (filterProperty: NodeFilterProperty, filterIndex: number, newValue: string) => {
		const updatedFilter: NodeFilterProperty = {...filterProperty};
		setFilters(filterableProperties.map((f, i) => (filterIndex == i ? updatedFilter : f)));
	};

	const clearAllFilters = () => {
		const updatedFilters = filterableProperties.map(f => {
			return {...f, value: ''};
		});

		setFilters(updatedFilters);
	};

	let path = `${state.databasesFolderPath}`;

	return (
		<>
			<FilterHeading databasesPath={path}/>
			<FilterTable filters={filterableProperties} onSelectedFilter={updateFilterDescription} onFilterValueChange={updateFilterValue} />
			<FilterDescription description={filterablePropertyDescription} />
			<Button onClick={clearAllFilters}>Clear All</Button>
			<Button>OK</Button>
		</>
	);
}
