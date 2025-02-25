/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import CompareDiffEditor from "./components/CompareDiffEditor";
import SelectSchemasPanel from "./components/SelectSchemasPanel";

export const SchemaComparePage = () => {
    return (
        <div>
            <SelectSchemasPanel />
            <CompareDiffEditor />
        </div>
    );
};
