/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import SchemaDifferences from "./components/SchemaDifferences";
import SelectSchemasPanel from "./components/SelectSchemasPanel";
import CompareDiffEditor from "./components/CompareDiffEditor";

export const SchemaComparePage = () => {
    const [selectedDiffId, setSelectedDiffId] = useState(-1);

    const handleDiffSelected = (id: number): void => {
        setSelectedDiffId(id);
    };

    return (
        <div>
            <SelectSchemasPanel />
            <SchemaDifferences onDiffSelected={handleDiffSelected} />
            {selectedDiffId !== -1 && (
                <CompareDiffEditor selectedDiffId={selectedDiffId} />
            )}
        </div>
    );
};
