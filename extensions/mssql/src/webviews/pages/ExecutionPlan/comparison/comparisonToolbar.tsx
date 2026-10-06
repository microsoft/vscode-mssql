/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, ToolbarDivider } from "@fluentui/react-components";
import {
    ArrowSyncRegular,
    DocumentAddRegular,
    DocumentBulletListFilled,
    DocumentBulletListRegular,
    SplitHorizontalRegular,
    SplitVerticalRegular,
    ZoomFitRegular,
    ZoomInRegular,
    ZoomOutRegular,
} from "@fluentui/react-icons";

import {
    SearchPlanIcon,
    TooltipIcon16Regular,
    TooltipOffIcon16Regular,
    ZoomOriginalSizeIcon16Regular,
} from "../../../common/icons/executionPlanIcons";
import { locConstants } from "../../../common/locConstants";
import { ExecutionPlanGraphController } from "../executionPlanGraphController";
import { ComparisonOrientation, ComparisonSide, comparisonSides } from "./comparisonModel";

interface ComparisonToolbarProps {
    controllers: Record<ComparisonSide, ExecutionPlanGraphController | null>;
    /** True once both panes have a plan, when picking another replaces the secondary one. */
    replacesPlan: boolean;
    onPickPlan: () => void;
    orientation: ComparisonOrientation;
    onToggleOrientation: () => void;
    propertiesOpen: boolean;
    onToggleProperties: () => void;
    findSide: ComparisonSide | undefined;
    onToggleFind: (side: ComparisonSide) => void;
    tooltipsEnabled: boolean;
    onToggleTooltips: () => void;
}

/** Commands for the whole comparison. Zoom commands act on both plans. */
export function ComparisonToolbar({
    controllers,
    replacesPlan,
    onPickPlan,
    orientation,
    onToggleOrientation,
    propertiesOpen,
    onToggleProperties,
    findSide,
    onToggleFind,
    tooltipsEnabled,
    onToggleTooltips,
}: ComparisonToolbarProps) {
    const readyControllers = comparisonSides
        .map((side) => controllers[side])
        .filter((controller) => controller !== null);
    const noPlans = readyControllers.length === 0;
    const forEachPlan = (action: (controller: ExecutionPlanGraphController) => void) => () =>
        readyControllers.forEach(action);
    const pickLabel = replacesPlan
        ? locConstants.executionPlan.replaceExecutionPlan
        : locConstants.executionPlan.addExecutionPlan;
    const orientationLabel =
        orientation === "horizontal"
            ? locConstants.executionPlan.switchToSideBySideComparison
            : locConstants.executionPlan.switchToStackedComparison;
    const findButton = (side: ComparisonSide, planNumber: 1 | 2, label: string) => (
        <ToolbarButton
            icon={<SearchPlanIcon planNumber={planNumber} selected={findSide === side} />}
            disabled={!controllers[side]}
            onClick={() => onToggleFind(side)}
            title={label}
            aria-label={label}
            aria-pressed={findSide === side}
        />
    );

    return (
        <Toolbar
            className="execution-plan-comparison-toolbar"
            aria-label={locConstants.executionPlan.compareExecutionPlans}>
            <ToolbarButton
                icon={replacesPlan ? <ArrowSyncRegular /> : <DocumentAddRegular />}
                onClick={onPickPlan}
                title={pickLabel}
                aria-label={pickLabel}
            />
            <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
            <ToolbarButton
                icon={<ZoomInRegular />}
                disabled={noPlans}
                onClick={forEachPlan((controller) => controller.zoomIn())}
                title={locConstants.executionPlan.zoomIn}
                aria-label={locConstants.executionPlan.zoomIn}
            />
            <ToolbarButton
                icon={<ZoomOutRegular />}
                disabled={noPlans}
                onClick={forEachPlan((controller) => controller.zoomOut())}
                title={locConstants.executionPlan.zoomOut}
                aria-label={locConstants.executionPlan.zoomOut}
            />
            <ToolbarButton
                icon={<ZoomFitRegular />}
                disabled={noPlans}
                onClick={forEachPlan((controller) => controller.zoomToFit())}
                title={locConstants.executionPlan.zoomToFit}
                aria-label={locConstants.executionPlan.zoomToFit}
            />
            <ToolbarButton
                icon={<ZoomOriginalSizeIcon16Regular />}
                disabled={noPlans}
                onClick={forEachPlan((controller) => controller.setZoomLevel(100))}
                title={locConstants.executionPlan.resetZoom}
                aria-label={locConstants.executionPlan.resetZoom}
            />
            <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
            <ToolbarButton
                icon={
                    orientation === "horizontal" ? (
                        <SplitVerticalRegular />
                    ) : (
                        <SplitHorizontalRegular />
                    )
                }
                onClick={onToggleOrientation}
                title={orientationLabel}
                aria-label={orientationLabel}
            />
            <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
            <ToolbarButton
                icon={propertiesOpen ? <DocumentBulletListFilled /> : <DocumentBulletListRegular />}
                disabled={!controllers.primary}
                onClick={onToggleProperties}
                title={locConstants.executionPlan.properties}
                aria-label={locConstants.executionPlan.properties}
                aria-pressed={propertiesOpen}
            />
            {findButton("primary", 1, locConstants.executionPlan.findPrimaryPlan)}
            {findButton("secondary", 2, locConstants.executionPlan.findSecondaryPlan)}
            <ToolbarButton
                icon={tooltipsEnabled ? <TooltipIcon16Regular /> : <TooltipOffIcon16Regular />}
                disabled={noPlans}
                onClick={onToggleTooltips}
                title={locConstants.executionPlan.toggleTooltips}
                aria-label={locConstants.executionPlan.toggleTooltips}
                aria-pressed={tooltipsEnabled}
            />
        </Toolbar>
    );
}
