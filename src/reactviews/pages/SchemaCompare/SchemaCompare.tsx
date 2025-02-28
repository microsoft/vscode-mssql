/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import SchemaDifferences from "./components/SchemaDifferences";
import SelectSchemasPanel from "./components/SelectSchemasPanel";
// import CompareDiffEditor from "./components/CompareDiffEditor";

export const SchemaComparePage = () => {
    return (
        <div>
            <SelectSchemasPanel />
            <SchemaDifferences />
            {/* <CompareDiffEditor /> */}
        </div>
    );
};
