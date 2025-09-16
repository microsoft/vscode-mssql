/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useEffect, useState } from "react";
import { type Column, type GridOption, SlickgridReact } from "slickgrid-react";
import "@slickgrid-universal/common/dist/styles/css/slickgrid-theme-default.css";

interface User {
    firstName: string;
    lastName: string;
    age: number;
}

export default function TableDataGrid2() {
    const [columns, setColumns] = useState<Column[]>(); // it could also be `Column<User>[]`
    const [options, setOptions] = useState<GridOption>();
    const [dataset, setDataset] = useState<User[]>(getData());

    useEffect(() => defineGrid(), []);

    function defineGrid() {
        setColumns([
            { id: "firstName", name: "First Name", field: "firstName", sortable: true },
            { id: "lastName", name: "Last Name", field: "lastName", sortable: true },
            { id: "age", name: "Age", field: "age", type: "number", sortable: true },
        ]);

        setOptions({
            /*...*/
        }); // optional grid options
    }

    function getData() {
        return [
            { id: 1, firstName: "John", lastName: "Doe", age: 20 },
            { id: 2, firstName: "Jane", lastName: "Smith", age: 21 },
        ];
    }

    return !options ? null : (
        <SlickgridReact
            gridId="my-test-grid"
            columns={columns}
            options={options}
            dataset={dataset}
        />
    );
}
