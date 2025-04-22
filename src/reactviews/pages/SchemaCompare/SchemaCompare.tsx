/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState, useRef } from "react";
import SchemaDifferences from "./components/SchemaDifferences";
import SelectSchemasPanel from "./components/SelectSchemasPanel";
import CompareDiffEditor from "./components/CompareDiffEditor";
import SchemaSelectorDrawer from "./components/SchemaSelectorDrawer";
import CompareActionBar from "./components/CompareActionBar";
import SchemaOptionsDrawer from "./components/SchemaOptionsDrawer";
import { schemaCompareContext } from "./SchemaCompareStateProvider";
import Message from "./components/Message";
import { makeStyles } from "@fluentui/react-components";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
    },
    contentContainer: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        position: "relative",
    },
    resizableContainer: {
        display: "flex",
        flexDirection: "column",
        flex: 1,
        overflow: "hidden",
        position: "relative",
    },
});

export const SchemaComparePage = () => {
    const classes = useStyles();
    const context = useContext(schemaCompareContext);
    const [selectedDiffId, setSelectedDiffId] = useState(0);
    const [showDrawer, setShowDrawer] = useState(false);
    const [showOptionsDrawer, setShowOptionsDrawer] = useState(false);
    const [endpointType, setEndpointType] = useState<"source" | "target">("source");

    // Create refs for the resizable components
    const differencesRef = useRef<HTMLDivElement>(null);
    const diffEditorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        context.isSqlProjectExtensionInstalled();
    }, []);

    const handleSelectSchemaClicked = (endpointType: "source" | "target"): void => {
        setShowDrawer(true);
        setEndpointType(endpointType);
    };

    const handleDiffSelected = (id: number): void => {
        setSelectedDiffId(id);
    };

    const handleShowDrawer = (show: boolean): void => {
        setShowDrawer(show);
    };

    const openOptionsDialog = (): void => {
        setShowOptionsDrawer(true);
    };

    const handleShowOptionsDrawer = (show: boolean): void => {
        setShowOptionsDrawer(show);
    };

    const showMessage = () => {
        if (
            !context.state.schemaCompareResult ||
            context.state.schemaCompareResult.areEqual ||
            context.state.isComparisonInProgress
        ) {
            return true;
        }

        return false;
    };

    return (
        <div className={classes.container}>
            <CompareActionBar onOptionsClicked={openOptionsDialog} />
            <SelectSchemasPanel onSelectSchemaClicked={handleSelectSchemaClicked} />

            {showMessage() && <Message />}

            {!showMessage() && (
                <div className={classes.contentContainer}>
                    <div className={classes.resizableContainer}>
                        <SchemaDifferences
                            ref={differencesRef}
                            selectedDiffId={selectedDiffId}
                            onDiffSelected={handleDiffSelected}
                            siblingRef={diffEditorRef}
                        />

                        {selectedDiffId !== -1 && (
                            <CompareDiffEditor
                                ref={diffEditorRef}
                                selectedDiffId={selectedDiffId}
                            />
                        )}
                    </div>
                </div>
            )}

            {showDrawer && (
                <SchemaSelectorDrawer
                    show={showDrawer}
                    endpointType={endpointType}
                    showDrawer={handleShowDrawer}
                />
            )}

            {showOptionsDrawer && (
                <SchemaOptionsDrawer
                    show={showOptionsDrawer}
                    showDrawer={handleShowOptionsDrawer}
                />
            )}
        </div>
    );
};
