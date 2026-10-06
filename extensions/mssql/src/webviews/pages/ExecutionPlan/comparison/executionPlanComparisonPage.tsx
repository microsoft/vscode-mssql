/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import "./comparison.css";

import { Button, Spinner, tokens } from "@fluentui/react-components";
import { AddSquareRegular } from "@fluentui/react-icons";
import { useCallback, useEffect, useState } from "react";

import { ShowComparisonQueryNotification } from "../../../../sharedInterfaces/executionPlanComparison";
import { ApiStatus } from "../../../../sharedInterfaces/webview";
import { locConstants } from "../../../common/locConstants";
import { useVscodeWebview } from "../../../common/vscodeWebviewProvider";
import { ComparisonOrientation, ComparisonSide } from "./comparisonModel";
import { ComparisonPlanPane } from "./comparisonPlanPane";
import { ComparisonPropertiesPanel } from "./comparisonPropertiesPanel";
import { ComparisonSplit } from "./comparisonSplit";
import { ComparisonToolbar } from "./comparisonToolbar";
import { useComparisonSources } from "./useComparisonSources";
import { useGraphComparison } from "./useGraphComparison";
import { useLinkedSelection } from "./useLinkedSelection";

/** Compares two execution plans side by side, outlining the areas they have in common. */
export function ExecutionPlanComparisonPage() {
    const { extensionRpc } = useVscodeWebview();
    const {
        loaded,
        panes,
        errorMessage: sourceError,
        pickSource,
        selectGraph,
    } = useComparisonSources();
    const comparison = useGraphComparison(
        panes.primary?.source.graphs[panes.primary.graphIndex],
        panes.secondary?.source.graphs[panes.secondary.graphIndex],
    );
    const { controllers, selectedNodes, onReady, onSelectionChange } = useLinkedSelection(
        comparison.maps,
    );
    const [orientation, setOrientation] = useState<ComparisonOrientation>("horizontal");
    const [propertiesOpen, setPropertiesOpen] = useState(false);
    const [findSide, setFindSide] = useState<ComparisonSide>();
    const [tooltipsEnabled, setTooltipsEnabled] = useState(true);

    // Panes remount when they change statement or plan, so apply the setting to new graphs too.
    useEffect(() => {
        controllers.primary?.setTooltipsEnabled(tooltipsEnabled);
        controllers.secondary?.setTooltipsEnabled(tooltipsEnabled);
    }, [controllers, tooltipsEnabled]);

    const showQuery = useCallback(
        (query: string) =>
            void extensionRpc.sendNotification(ShowComparisonQueryNotification.type, { query }),
        [extensionRpc],
    );
    const closeFind = useCallback(() => setFindSide(undefined), []);

    if (!loaded) {
        return (
            <main className="execution-plan-comparison execution-plan-comparison-status">
                <Spinner label={locConstants.executionPlan.loadingExecutionPlan} />
            </main>
        );
    }

    // The toolbar fills the first empty pane, and replaces the secondary plan once both are full.
    const toolbarPickSide: ComparisonSide = panes.primary ? "secondary" : "primary";
    const errorMessage = sourceError ?? comparison.errorMessage;
    const renderPane = (side: ComparisonSide) => {
        const pane = panes[side];
        if (!pane) {
            return (
                <div className="execution-plan-comparison-placeholder">
                    <AddSquareRegular aria-hidden />
                    <p>{locConstants.executionPlan.choosePlanToCompare}</p>
                    <Button
                        appearance="primary"
                        icon={<AddSquareRegular />}
                        onClick={() => void pickSource(side)}>
                        {locConstants.executionPlan.addExecutionPlan}
                    </Button>
                </div>
            );
        }
        return (
            <ComparisonPlanPane
                key={`${pane.key}-${pane.graphIndex}`}
                side={side}
                pane={pane}
                groupRoots={
                    side === "primary"
                        ? comparison.maps.primaryGroupRoots
                        : comparison.maps.secondaryGroupRoots
                }
                onReady={onReady}
                onSelectionChange={onSelectionChange}
                onSelectGraph={selectGraph}
                onShowQuery={showQuery}
                showFind={findSide === side}
                onCloseFind={closeFind}
            />
        );
    };

    return (
        <main
            className="execution-plan-comparison"
            style={{ color: tokens.colorNeutralForeground1 }}>
            <ComparisonToolbar
                controllers={controllers}
                replacesPlan={panes.primary !== undefined && panes.secondary !== undefined}
                onPickPlan={() => void pickSource(toolbarPickSide)}
                orientation={orientation}
                onToggleOrientation={() =>
                    setOrientation((current) =>
                        current === "horizontal" ? "vertical" : "horizontal",
                    )
                }
                propertiesOpen={propertiesOpen}
                onToggleProperties={() => setPropertiesOpen((open) => !open)}
                findSide={findSide}
                onToggleFind={(side) =>
                    setFindSide((current) => (current === side ? undefined : side))
                }
                tooltipsEnabled={tooltipsEnabled}
                onToggleTooltips={() => setTooltipsEnabled((enabled) => !enabled)}
            />
            {errorMessage && (
                <div className="execution-plan-comparison-error" role="alert">
                    {errorMessage}
                </div>
            )}
            <div className="execution-plan-comparison-content">
                <ComparisonSplit
                    orientation={orientation}
                    first={renderPane("primary")}
                    second={renderPane("secondary")}
                />
                {propertiesOpen && (
                    <ComparisonPropertiesPanel
                        primary={selectedNodes.primary}
                        secondary={selectedNodes.secondary}
                        orientation={orientation}
                        onClose={() => setPropertiesOpen(false)}
                    />
                )}
            </div>
            {comparison.status === ApiStatus.Loading && (
                <div className="execution-plan-comparison-loading" aria-live="polite">
                    <Spinner size="small" label={locConstants.executionPlan.comparisonLoading} />
                </div>
            )}
        </main>
    );
}
