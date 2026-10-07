/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Menu,
    MenuButton,
    MenuItem,
    MenuList,
    MenuPopover,
    MenuTrigger,
    Toolbar,
    ToolbarButton,
    ToolbarDivider,
} from "@fluentui/react-components";
import {
    ArrowSwapRegular,
    ChevronDown12Regular,
    DocumentAddRegular,
    DocumentBulletListFilled,
    DocumentBulletListRegular,
    DocumentSyncRegular,
    LayerFilled,
    LayerRegular,
    LinkFilled,
    LinkRegular,
    MapFilled,
    MapRegular,
    SplitHorizontalRegular,
    SplitVerticalRegular,
} from "@fluentui/react-icons";
import { ReactElement } from "react";

import {
    TooltipIcon16Regular,
    TooltipOffIcon16Regular,
} from "../../../common/icons/executionPlanIcons";
import { locConstants } from "../../../common/locConstants";
import { SegmentedControl, SegmentedControlOption } from "../../../common/segmentedControl";
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

/** A toolbar button that stays pressed while its setting is on. */
function ToggleButton({
    label,
    pressed,
    icon,
    pressedIcon,
    disabled,
    onToggle,
}: {
    label: string;
    pressed: boolean;
    icon: ReactElement;
    pressedIcon?: ReactElement;
    disabled?: boolean;
    onToggle: () => void;
}) {
    return (
        <ToolbarButton
            icon={pressed && pressedIcon ? pressedIcon : icon}
            disabled={disabled}
            onClick={onToggle}
            title={label}
            aria-label={label}
            aria-pressed={pressed}
        />
    );
}

interface ComparisonToolbarProps {
    /** False until a plan is loaded, which the view commands need. */
    hasPlans: boolean;
    /** The name of the plan in each pane, or undefined while the pane is empty. */
    planNames: Record<ComparisonSide, string | undefined>;
    /** Fills the first empty pane. */
    onAddPlan: () => void;
    onReplacePlan: (side: ComparisonSide) => void;
    canSwap: boolean;
    onSwap: () => void;
    orientation: ComparisonOrientation;
    onOrientationChange: (orientation: ComparisonOrientation) => void;
    minimapsVisible: boolean;
    onToggleMinimaps: () => void;
    similarAreasVisible: boolean;
    onToggleSimilarAreas: () => void;
    viewsSynced: boolean;
    onToggleViewsSynced: () => void;
    propertiesOpen: boolean;
    onToggleProperties: () => void;
    tooltipsEnabled: boolean;
    onToggleTooltips: () => void;
}

/**
 * Commands for the whole comparison, grouped as: adding plans; arranging them; what the plans
 * show; and the panels around them. Each plan has its own zoom and find controls on its canvas.
 */
export function ComparisonToolbar({
    hasPlans,
    planNames,
    onAddPlan,
    onReplacePlan,
    canSwap,
    onSwap,
    orientation,
    onOrientationChange,
    minimapsVisible,
    onToggleMinimaps,
    similarAreasVisible,
    onToggleSimilarAreas,
    viewsSynced,
    onToggleViewsSynced,
    propertiesOpen,
    onToggleProperties,
    tooltipsEnabled,
    onToggleTooltips,
}: ComparisonToolbarProps) {
    const replaceLabels: Record<ComparisonSide, string> =
        orientation === "stacked"
            ? {
                  primary: locConstants.executionPlan.replaceTopPlan,
                  secondary: locConstants.executionPlan.replaceBottomPlan,
              }
            : {
                  primary: locConstants.executionPlan.replaceLeftPlan,
                  secondary: locConstants.executionPlan.replaceRightPlan,
              };

    return (
        <Toolbar
            className="execution-plan-comparison-toolbar"
            aria-label={locConstants.executionPlan.compareExecutionPlans}>
            {planNames.primary !== undefined && planNames.secondary !== undefined ? (
                // With both panes full, adding a plan means choosing which one it replaces.
                <Menu>
                    <MenuTrigger disableButtonEnhancement>
                        <MenuButton
                            appearance="subtle"
                            className="execution-plan-comparison-plan-menu"
                            icon={<DocumentSyncRegular />}
                            menuIcon={<ChevronDown12Regular />}
                            title={locConstants.executionPlan.replaceExecutionPlan}
                            aria-label={locConstants.executionPlan.replaceExecutionPlan}>
                            {/* Fluent leaves out the chevron of an icon-only menu button. */}
                            <span className="execution-plan-comparison-visually-hidden">
                                {locConstants.executionPlan.replaceExecutionPlan}
                            </span>
                        </MenuButton>
                    </MenuTrigger>
                    <MenuPopover>
                        <MenuList>
                            {comparisonSides.map((side) => (
                                <MenuItem
                                    key={side}
                                    secondaryContent={planNames[side]}
                                    onClick={() => onReplacePlan(side)}>
                                    {replaceLabels[side]}
                                </MenuItem>
                            ))}
                        </MenuList>
                    </MenuPopover>
                </Menu>
            ) : (
                <ToolbarButton
                    icon={<DocumentAddRegular />}
                    onClick={onAddPlan}
                    title={locConstants.executionPlan.addExecutionPlan}
                    aria-label={locConstants.executionPlan.addExecutionPlan}
                />
            )}
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
            <ToggleButton
                label={locConstants.executionPlan.toggleMinimap}
                pressed={minimapsVisible}
                icon={<MapRegular />}
                pressedIcon={<MapFilled />}
                disabled={!hasPlans}
                onToggle={onToggleMinimaps}
            />
            <ToggleButton
                label={locConstants.executionPlan.toggleSimilarAreas}
                pressed={similarAreasVisible}
                icon={<LayerRegular />}
                pressedIcon={<LayerFilled />}
                disabled={!hasPlans}
                onToggle={onToggleSimilarAreas}
            />
            <ToggleButton
                label={locConstants.executionPlan.syncZoomAndScroll}
                pressed={viewsSynced}
                icon={<LinkRegular />}
                pressedIcon={<LinkFilled />}
                disabled={!hasPlans}
                onToggle={onToggleViewsSynced}
            />
            <ToolbarDivider className="execution-plan-comparison-toolbar-divider" />
            <ToggleButton
                label={locConstants.executionPlan.properties}
                pressed={propertiesOpen}
                icon={<DocumentBulletListRegular />}
                pressedIcon={<DocumentBulletListFilled />}
                disabled={!hasPlans}
                onToggle={onToggleProperties}
            />
            <ToggleButton
                label={locConstants.executionPlan.toggleTooltips}
                pressed={tooltipsEnabled}
                icon={<TooltipOffIcon16Regular />}
                pressedIcon={<TooltipIcon16Regular />}
                disabled={!hasPlans}
                onToggle={onToggleTooltips}
            />
        </Toolbar>
    );
}
