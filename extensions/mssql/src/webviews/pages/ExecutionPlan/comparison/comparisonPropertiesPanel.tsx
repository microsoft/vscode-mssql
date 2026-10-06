/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Button, Input, Toolbar, ToolbarButton } from "@fluentui/react-components";
import {
    ArrowSortDownLines16Regular,
    Dismiss16Regular,
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
import { FilterIcon16Regular } from "../../../common/icons/executionPlanIcons";
import { locConstants } from "../../../common/locConstants";
import { ComparisonOrientation, ExecutionPlanComparisonPropertySort } from "./comparisonModel";
import { ComparisonPropertiesGrid } from "./comparisonPropertiesGrid";

const MIN_WIDTH = 360;
const DEFAULT_MAX_WIDTH = 560;

function clampWidth(width: number): number {
    return Math.min(window.innerWidth * 0.8, Math.max(MIN_WIDTH, width));
}

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

/** A resizable side panel that compares the properties of the selected operators. */
export function ComparisonPropertiesPanel({
    primary,
    secondary,
    orientation,
    onClose,
}: {
    primary: ExecutionPlanNode | undefined;
    secondary: ExecutionPlanNode | undefined;
    orientation: ComparisonOrientation;
    onClose: () => void;
}) {
    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<ExecutionPlanComparisonPropertySort>("importance");
    const [width, setWidth] = useState(() =>
        clampWidth(Math.min(DEFAULT_MAX_WIDTH, window.innerWidth * 0.46)),
    );
    const horizontal = orientation === "horizontal";
    const primaryTitle = horizontal
        ? locConstants.executionPlan.topOperation(primary?.name ?? "")
        : locConstants.executionPlan.leftOperation(primary?.name ?? "");
    const secondaryTitle = horizontal
        ? locConstants.executionPlan.bottomOperation(secondary?.name ?? "")
        : locConstants.executionPlan.rightOperation(secondary?.name ?? "");

    const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        const onPointerMove = (moveEvent: PointerEvent) =>
            setWidth(clampWidth(startWidth - moveEvent.clientX + startX));
        const onPointerUp = () => {
            document.removeEventListener("pointermove", onPointerMove);
            document.removeEventListener("pointerup", onPointerUp);
        };
        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
    };
    const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step = event.shiftKey ? 50 : 10;
        if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            setWidth((current) => clampWidth(current + (event.key === "ArrowLeft" ? step : -step)));
        }
    };

    return (
        <aside
            className="execution-plan-comparison-properties"
            style={{ width: `${width}px` }}
            aria-label={locConstants.executionPlan.comparisonProperties}>
            <div
                className="execution-plan-comparison-properties-resizer"
                role="separator"
                aria-orientation="vertical"
                aria-label={`${locConstants.queryResult.resize} ${locConstants.executionPlan.comparisonProperties}`}
                aria-valuemin={MIN_WIDTH}
                aria-valuenow={Math.round(width)}
                tabIndex={0}
                onPointerDown={resizeFromPointer}
                onKeyDown={resizeFromKeyboard}
            />
            <div className="execution-plan-comparison-properties-title">
                <strong>{locConstants.executionPlan.comparisonProperties}</strong>
                <Button
                    appearance="subtle"
                    size="small"
                    icon={<Dismiss16Regular />}
                    title={locConstants.common.close}
                    aria-label={locConstants.common.close}
                    onClick={onClose}
                />
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
