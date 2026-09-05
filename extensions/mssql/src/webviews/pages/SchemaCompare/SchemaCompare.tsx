/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useContext, useEffect, useState } from "react";
import SchemaDifferences from "./components/SchemaDifferences";
import SelectSchemasPanel from "./components/SelectSchemasPanel";
import CompareDiffEditor from "./components/CompareDiffEditor";
import SchemaSelectorDrawer from "./components/SchemaSelectorDrawer";
import CompareActionBar from "./components/CompareActionBar";
import SchemaOptionsDrawer from "./components/SchemaOptionsDrawer";
import { schemaCompareContext } from "./SchemaCompareStateProvider";
import { useSchemaCompareSelector } from "./schemaCompareSelector";
import Message from "./components/Message";
import { makeStyles } from "@fluentui/react-components";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { SchemaCompareLayout } from "../../../sharedInterfaces/schemaCompare";

const useStyles = makeStyles({
    container: {
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
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
    resizeHandle: {
        height: "2px",
        backgroundColor: "var(--vscode-editorWidget-border)",
    },
});

export const SchemaComparePage = () => {
    const classes = useStyles();
    const context = useContext(schemaCompareContext);
    const schemaCompareResult = useSchemaCompareSelector((s) => s.schemaCompareResult);
    const isComparisonInProgress = useSchemaCompareSelector((s) => s.isComparisonInProgress);
    const isApplyInProgress = useSchemaCompareSelector((s) => s.isApplyInProgress);
    const applyFailed = useSchemaCompareSelector((s) => s.applyFailed);
    const [selectedDiffId, setSelectedDiffId] = useState(0);
    const [showDrawer, setShowDrawer] = useState(false);
    const [showOptionsDrawer, setShowOptionsDrawer] = useState(false);
    const [endpointType, setEndpointType] = useState<"source" | "target">("source");
    const groupBy = useSchemaCompareSelector((s) => s.groupBy);
    const layout = useSchemaCompareSelector((s) => s.layout);
    const [showComparisonDetails, setShowComparisonDetails] = useState(true);
    const [navigableDiffIds, setNavigableDiffIds] = useState<number[]>([]);

    useEffect(() => {
        context.isSqlProjectExtensionInstalled();
    }, []);

    const handleSelectSchemaClicked = (endpointType: "source" | "target"): void => {
        setShowDrawer(true);
        setEndpointType(endpointType);
    };

    const handleDiffSelected = (id: number): void => {
        setSelectedDiffId(id);
        setShowComparisonDetails(true);
    };

    const handleOpenComparisonDetails = (): void => {
        setShowComparisonDetails(true);
        requestAnimationFrame(() => {
            document.querySelector<HTMLElement>("[data-schema-compare-details]")?.focus();
        });
    };

    const handlePreviousDiff = (): void => {
        if (navigableDiffIds.length === 0) {
            return;
        }
        const currentIndex = navigableDiffIds.indexOf(selectedDiffId);
        const previousIndex = currentIndex <= 0 ? navigableDiffIds.length - 1 : currentIndex - 1;
        handleDiffSelected(navigableDiffIds[previousIndex]);
    };

    const handleNextDiff = (): void => {
        if (navigableDiffIds.length === 0) {
            return;
        }
        const currentIndex = navigableDiffIds.indexOf(selectedDiffId);
        const nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % navigableDiffIds.length;
        handleDiffSelected(navigableDiffIds[nextIndex]);
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
            !schemaCompareResult ||
            schemaCompareResult.areEqual ||
            isComparisonInProgress ||
            isApplyInProgress ||
            applyFailed
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
                        <PanelGroup direction="vertical">
                            <Panel defaultSize={60}>
                                <SchemaDifferences
                                    selectedDiffId={selectedDiffId}
                                    onDiffSelected={handleDiffSelected}
                                    groupBy={groupBy}
                                    onGroupByChange={(nextGroupBy) =>
                                        context.setGroupBy(nextGroupBy)
                                    }
                                    layout={layout}
                                    onLayoutChange={(nextLayout: SchemaCompareLayout) =>
                                        context.setLayout(nextLayout)
                                    }
                                    onNavigableDiffIdsChange={setNavigableDiffIds}
                                    onOpenComparisonDetails={handleOpenComparisonDetails}
                                />
                            </Panel>

                            {selectedDiffId !== -1 && showComparisonDetails && (
                                <>
                                    <PanelResizeHandle className={classes.resizeHandle} />
                                    <CompareDiffEditor
                                        selectedDiffId={selectedDiffId}
                                        onClose={() => setShowComparisonDetails(false)}
                                        onPrevious={handlePreviousDiff}
                                        onNext={handleNextDiff}
                                        hasPrevious={navigableDiffIds.length > 1}
                                        hasNext={navigableDiffIds.length > 1}
                                        currentPosition={Math.max(
                                            navigableDiffIds.indexOf(selectedDiffId) + 1,
                                            1,
                                        )}
                                        totalDifferences={navigableDiffIds.length}
                                    />
                                </>
                            )}
                        </PanelGroup>
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
