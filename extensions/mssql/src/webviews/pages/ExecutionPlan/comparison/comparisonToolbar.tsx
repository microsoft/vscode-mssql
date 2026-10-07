/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Toolbar, ToolbarButton, ToolbarDivider } from "@fluentui/react-components";
import {
    ArrowSwapRegular,
    ArrowSyncRegular,
    DocumentAddRegular,
    DocumentBulletListFilled,
    DocumentBulletListRegular,
    LayerFilled,
    LayerRegular,
    MapFilled,
    MapRegular,
    SplitHorizontalRegular,
    SplitVerticalRegular,
} from "@fluentui/react-icons";

import {
    SearchPlanIcon,
    TooltipIcon16Regular,
    TooltipOffIcon16Regular,
} from "../../../common/icons/executionPlanIcons";
import { locConstants } from "../../../common/locConstants";
import { SegmentedControl, SegmentedControlOption } from "../../../common/segmentedControl";
import { ExecutionPlanGraphController } from "../executionPlanGraphController";
import { ComparisonOrientation, ComparisonSide, comparisonSides } from "./comparisonModel";

const orientationOptions: SegmentedControlOption<ComparisonOrientation>[] = [
    {
        value: "sideBySide",
        icon: <SplitVerticalRegular />,
        title: locConstants.executionPlan.sideBySide,
    },
    {
        value: "stacked",
        icon: <SplitHorizontalRegular />,
        title: locConstants.executionPlan.stacked,
    },
];

interface ComparisonToolbarProps {
    controllers: Record<ComparisonSide, ExecutionPlanGraphController | null>;
    /** True once both panes have a plan, when picking another replaces the secondary one. */
    replacesPlan: boolean;
    onPickPlan: () => void;
    canSwap: boolean;
    onSwap: () => void;
    orientation: ComparisonOrientation;
    onOrientationChange: (orientation: ComparisonOrientation) => void;
    minimapsVisible: boolean;
    onToggleMinimaps: () => void;
    similarAreasVisible: boolean;
    onToggleSimilarAreas: () => void;
    propertiesOpen: boolean;
    onToggleProperties: () => void;
    findSide: ComparisonSide | undefined;
    onToggleFind: (side: ComparisonSide) => void;
    tooltipsEnabled: boolean;
    onToggleTooltips: () => void;
}

/** Commands for the whole comparison. Each plan has its own zoom controls on its canvas. */
export function ComparisonToolbar({
    controllers,
    replacesPlan,
    onPickPlan,
    canSwap,
    onSwap,
    orientation,
    onOrientationChange,
    minimapsVisible,
    onToggleMinimaps,
    similarAreasVisible,
    onToggleSimilarAreas,
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
    const pickLabel = replacesPlan
        ? locConstants.executionPlan.replaceExecutionPlan
        : locConstants.executionPlan.addExecutionPlan;
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
                icon={<ArrowSwapRegular />}
                disabled={!canSwap}
                onClick={onSwap}
                title={locConstants.executionPlan.swapPlans}
                aria-label={locConstants.executionPlan.swapPlans}
            />
            <SegmentedControl<ComparisonOrientation>
                className="execution-plan-comparison-layout"
                value={orientation}
                options={orientationOptions}
                onValueChange={onOrientationChange}
                ariaLabel={locConstants.executionPlan.planLayout}
            />
            <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
            <ToolbarButton
                icon={minimapsVisible ? <MapFilled /> : <MapRegular />}
                disabled={noPlans}
                onClick={onToggleMinimaps}
                title={locConstants.executionPlan.toggleMinimap}
                aria-label={locConstants.executionPlan.toggleMinimap}
                aria-pressed={minimapsVisible}
            />
            <ToolbarButton
                icon={similarAreasVisible ? <LayerFilled /> : <LayerRegular />}
                disabled={noPlans}
                onClick={onToggleSimilarAreas}
                title={locConstants.executionPlan.toggleSimilarAreas}
                aria-label={locConstants.executionPlan.toggleSimilarAreas}
                aria-pressed={similarAreasVisible}
            />
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
