/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    Search16Regular,
    ZoomFit16Regular,
    ZoomIn16Regular,
    ZoomOut16Regular,
} from "@fluentui/react-icons";
import { ControlButton, Controls, useStore } from "@xyflow/react";
import { ReactElement } from "react";

import { ZoomOriginalSizeIcon16Regular } from "../../../common/icons/executionPlanIcons";
import { locConstants } from "../../../common/locConstants";
import { ExecutionPlanGraphController } from "../executionPlanGraphController";

/**
 * React Flow's controls panel for one plan. Its buttons go through the plan's controller, which
 * zooms around the top-left corner so the operators at the top of the plan stay in view.
 */
export function ComparisonZoomControls({
    controller,
}: {
    controller: ExecutionPlanGraphController | null;
}) {
    const atMaxZoom = useStore((state) => state.transform[2] >= state.maxZoom);
    const atMinZoom = useStore((state) => state.transform[2] <= state.minZoom);
    const button = (
        label: string,
        icon: ReactElement,
        action: (planController: ExecutionPlanGraphController) => void,
        disabled = false,
    ) => (
        <ControlButton
            title={label}
            aria-label={label}
            disabled={!controller || disabled}
            onClick={() => controller && action(controller)}>
            {icon}
        </ControlButton>
    );

    return (
        <Controls
            showZoom={false}
            showFitView={false}
            showInteractive={false}
            aria-label={locConstants.executionPlan.zoomControls}>
            {button(
                locConstants.executionPlan.zoomIn,
                <ZoomIn16Regular />,
                (planController) => planController.zoomIn(),
                atMaxZoom,
            )}
            {button(
                locConstants.executionPlan.zoomOut,
                <ZoomOut16Regular />,
                (planController) => planController.zoomOut(),
                atMinZoom,
            )}
            {button(locConstants.executionPlan.zoomToFit, <ZoomFit16Regular />, (planController) =>
                planController.zoomToFit(),
            )}
            {button(
                locConstants.executionPlan.resetZoom,
                <ZoomOriginalSizeIcon16Regular />,
                (planController) => planController.setZoomLevel(100),
            )}
        </Controls>
    );
}

/**
 * Opens the plan's find widget, from React Flow's controls panel at the top-right of the canvas.
 * The widget opens just left of it.
 */
export function ComparisonFindControl({
    label,
    open,
    disabled,
    onToggle,
}: {
    label: string;
    open: boolean;
    disabled: boolean;
    onToggle: () => void;
}) {
    return (
        <Controls
            className="execution-plan-comparison-find-control"
            position="top-right"
            showZoom={false}
            showFitView={false}
            showInteractive={false}
            aria-label={label}>
            <ControlButton
                title={label}
                aria-label={label}
                aria-pressed={open}
                disabled={disabled}
                onClick={onToggle}>
                <Search16Regular />
            </ControlButton>
        </Controls>
    );
}
