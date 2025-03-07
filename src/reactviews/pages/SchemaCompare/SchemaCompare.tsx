/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useState } from "react";
import SchemaDifferences from "./components/SchemaDifferences";
import SelectSchemasPanel from "./components/SelectSchemasPanel";
import CompareDiffEditor from "./components/CompareDiffEditor";
import SchemaSelectorDrawer from "./components/SchemaSelectorDrawer";
import CompareActionBar from "./components/CompareActionBar";

export const SchemaComparePage = () => {
    const [selectedDiffId, setSelectedDiffId] = useState(-1);
    const [showDrawer, setShowDrawer] = useState(false);
    const [endpointType, setEndpointType] = useState<"source" | "target">(
        "source",
    );

    const handleSelectSchemaClicked = (
        endpointType: "source" | "target",
    ): void => {
        setShowDrawer(true);
        setEndpointType(endpointType);
    };

    const handleDiffSelected = (id: number): void => {
        setSelectedDiffId(id);
    };

    const handleShowDrawer = (show: boolean): void => {
        setShowDrawer(show);
    };

    return (
        <div>
            <CompareActionBar />
            <SelectSchemasPanel
                onSelectSchemaClicked={handleSelectSchemaClicked}
            />
            <SchemaDifferences onDiffSelected={handleDiffSelected} />
            {selectedDiffId !== -1 && (
                <CompareDiffEditor selectedDiffId={selectedDiffId} />
            )}
            <SchemaSelectorDrawer
                show={showDrawer}
                endpointType={endpointType}
                showDrawer={handleShowDrawer}
            />
        </div>
    );
};
