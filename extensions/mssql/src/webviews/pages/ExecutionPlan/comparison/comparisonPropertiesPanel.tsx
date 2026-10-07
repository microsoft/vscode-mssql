/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Toolbar, ToolbarButton } from "@fluentui/react-components";
import {
    ArrowSortDownLines16Regular,
    Dismiss16Regular,
    PanelBottom20Regular,
    PanelRight20Regular,
    TextSortAscending16Regular,
    TextSortDescending16Regular,
} from "@fluentui/react-icons";
import {
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    ReactElement,
    useState,
} from "react";

import { ExecutionPlanNode } from "../../../../sharedInterfaces/executionPlan";
import { ExecutionPlanComparisonPropertiesDock } from "../../../../sharedInterfaces/executionPlanComparison";
import { FilterIcon16Regular } from "../../../common/icons/executionPlanIcons";
import { locConstants } from "../../../common/locConstants";
import { ComparisonOrientation, ExecutionPlanComparisonPropertySort } from "./comparisonModel";
import { ComparisonPropertiesGrid } from "./comparisonPropertiesGrid";

const MIN_WIDTH = 360;
const DEFAULT_MAX_WIDTH = 560;
const MIN_HEIGHT = 160;

function clampWidth(width: number): number {
    return Math.min(window.innerWidth * 0.8, Math.max(MIN_WIDTH, width));
}

function clampHeight(height: number): number {
    return Math.min(window.innerHeight * 0.8, Math.max(MIN_HEIGHT, height));
}

const dockOptions: {
    dock: ExecutionPlanComparisonPropertiesDock;
    icon: ReactElement;
    label: string;
}[] = [
    { dock: "side", icon: <PanelRight20Regular />, label: locConstants.executionPlan.dockToSide },
    {
        dock: "bottom",
        icon: <PanelBottom20Regular />,
        label: locConstants.executionPlan.dockToBottom,
    },
];

const sortOptions: {
    sort: ExecutionPlanComparisonPropertySort;
    icon: ReactElement;
    label: string;
}[] = [
    {
        sort: "importance",
        icon: <ArrowSortDownLines16Regular />,
        label: locConstants.executionPlan.importance,
    },
    {
        sort: "alphabetical",
        icon: <TextSortAscending16Regular />,
        label: locConstants.executionPlan.alphabetical,
    },
    {
        sort: "reverseAlphabetical",
        icon: <TextSortDescending16Regular />,
        label: locConstants.executionPlan.reverseAlphabetical,
    },
];

/**
 * A resizable panel, beside or below the plans, that compares the properties of the selected
 * operators.
 */
export function ComparisonPropertiesPanel({
    primary,
    secondary,
    orientation,
    dock,
    onDockChange,
    onClose,
}: {
    primary: ExecutionPlanNode | undefined;
    secondary: ExecutionPlanNode | undefined;
    orientation: ComparisonOrientation;
    dock: ExecutionPlanComparisonPropertiesDock;
    onDockChange: (dock: ExecutionPlanComparisonPropertiesDock) => void;
    onClose: () => void;
}) {
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<ExecutionPlanComparisonPropertySort>("importance");
    const [width, setWidth] = useState(() =>
        clampWidth(Math.min(DEFAULT_MAX_WIDTH, window.innerWidth * 0.46)),
    );
    const [height, setHeight] = useState(() => clampHeight(window.innerHeight * 0.4));
    const below = dock === "bottom";
    const stacked = orientation === "stacked";
    const primaryTitle = stacked
        ? locConstants.executionPlan.topOperation(primary?.name ?? "")
        : locConstants.executionPlan.leftOperation(primary?.name ?? "");
    const secondaryTitle = stacked
        ? locConstants.executionPlan.bottomOperation(secondary?.name ?? "")
        : locConstants.executionPlan.rightOperation(secondary?.name ?? "");

    // The panel grows away from the plans: leftward beside them, upward below them.
    const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const start = below ? event.clientY : event.clientX;
        const startSize = below ? height : width;
        const onPointerMove = (moveEvent: PointerEvent) => {
            const size = startSize + start - (below ? moveEvent.clientY : moveEvent.clientX);
            if (below) {
                setHeight(clampHeight(size));
            } else {
                setWidth(clampWidth(size));
            }
        };
        const onPointerUp = () => {
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
        };
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    };
    const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 50 : 10;
        const [grow, shrink] = below ? ["ArrowUp", "ArrowDown"] : ["ArrowLeft", "ArrowRight"];
        if (event.key !== grow && event.key !== shrink) {
            return;
        }
        event.preventDefault();
        const delta = event.key === grow ? step : -step;
        if (below) {
            setHeight((current) => clampHeight(current + delta));
        } else {
            setWidth((current) => clampWidth(current + delta));
        }
    };

    return (
        <aside
            className={`execution-plan-comparison-properties execution-plan-comparison-properties-${dock}`}
            style={below ? { height: `${height}px` } : { width: `${width}px` }}
            aria-label={locConstants.executionPlan.comparisonProperties}>
            <div
                className="execution-plan-comparison-properties-resizer"
                role="separator"
                aria-orientation={below ? "horizontal" : "vertical"}
                aria-label={`${locConstants.queryResult.resize} ${locConstants.executionPlan.comparisonProperties}`}
                aria-valuemin={below ? MIN_HEIGHT : MIN_WIDTH}
                aria-valuenow={Math.round(below ? height : width)}
                tabIndex={0}
                onPointerDown={resizeFromPointer}
                onKeyDown={resizeFromKeyboard}
            />
            <div className="execution-plan-comparison-properties-title">
                <strong>{locConstants.executionPlan.comparisonProperties}</strong>
                <div className="execution-plan-comparison-properties-actions">
                    {dockOptions.map((option) => (
                        <Button
                            key={option.dock}
                            appearance="subtle"
                            size="small"
                            className="execution-plan-comparison-dock-option"
                            icon={option.icon}
                            title={option.label}
                            aria-label={option.label}
                            aria-pressed={dock === option.dock}
                            onClick={() => onDockChange(option.dock)}
                        />
                    ))}
                    <Button
                        appearance="subtle"
                        size="small"
                        icon={<Dismiss16Regular />}
                        title={locConstants.common.close}
                        aria-label={locConstants.common.close}
                        onClick={onClose}
                    />
                </div>
            </div>
            <div className="execution-plan-comparison-operation-titles">
                <span title={primaryTitle}>{primaryTitle}</span>
                <span title={secondaryTitle}>{secondaryTitle}</span>
            </div>
            <div className="execution-plan-comparison-property-tools">
                <Input
                    size="small"
                    value={filter}
                    placeholder={locConstants.executionPlan.propertyFilter}
                    aria-label={locConstants.executionPlan.propertyFilter}
                    contentBefore={<FilterIcon16Regular />}
                    onChange={(_, data) => setFilter(data.value)}
                />
                <Toolbar size="small" aria-label={locConstants.executionPlan.importance}>
                    {sortOptions.map((option) => (
                        <ToolbarButton
                            key={option.sort}
                            icon={option.icon}
                            onClick={() => setSort(option.sort)}
                            title={option.label}
                            aria-label={option.label}
                            aria-pressed={sort === option.sort}
                        />
                    ))}
                </Toolbar>
            </div>
            <ComparisonPropertiesGrid
                primary={primary}
                secondary={secondary}
                filter={filter}
                sort={sort}
                orientation={orientation}
            />
        </aside>
    );
}
