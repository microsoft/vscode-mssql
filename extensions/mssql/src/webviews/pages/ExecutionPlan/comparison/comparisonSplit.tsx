/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    KeyboardEvent as ReactKeyboardEvent,
    PointerEvent as ReactPointerEvent,
    ReactNode,
    useRef,
    useState,
} from "react";

import { ComparisonOrientation } from "./comparisonModel";

const MIN_RATIO = 0.2;
const MAX_RATIO = 0.8;
const KEYBOARD_STEP = 0.05;

function clampRatio(ratio: number): number {
    return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

/** Two panes, stacked or side by side, with a draggable sash between them. */
export function ComparisonSplit({
    orientation,
    first,
    second,
}: {
    orientation: ComparisonOrientation;
    first: ReactNode;
    second: ReactNode;
}) {
    const [ratio, setRatio] = useState(0.5);
    const splitRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);
    const horizontal = orientation === "horizontal";

    const resizeFromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
        if (!draggingRef.current || !splitRef.current) {
            return;
        }
        const bounds = splitRef.current.getBoundingClientRect();
        setRatio(
            clampRatio(
                horizontal
                    ? (event.clientY - bounds.top) / bounds.height
                    : (event.clientX - bounds.left) / bounds.width,
            ),
        );
    };
    const resizeFromKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        const step =
            event.key === (horizontal ? "ArrowUp" : "ArrowLeft")
                ? -KEYBOARD_STEP
                : event.key === (horizontal ? "ArrowDown" : "ArrowRight")
                  ? KEYBOARD_STEP
                  : 0;
        if (step !== 0) {
            event.preventDefault();
            setRatio((current) => clampRatio(current + step));
        }
    };

    return (
        <div
            ref={splitRef}
            className={`execution-plan-comparison-split execution-plan-comparison-split-${orientation}`}
            onPointerMove={resizeFromPointer}
            onPointerUp={(event) => {
                draggingRef.current = false;
                event.currentTarget.releasePointerCapture(event.pointerId);
            }}>
            <div
                className="execution-plan-comparison-split-pane"
                style={{ flexBasis: `${ratio * 100}%` }}>
                {first}
            </div>
            <div
                className="execution-plan-comparison-sash"
                role="separator"
                tabIndex={0}
                aria-orientation={horizontal ? "horizontal" : "vertical"}
                aria-valuemin={MIN_RATIO * 100}
                aria-valuemax={MAX_RATIO * 100}
                aria-valuenow={Math.round(ratio * 100)}
                onKeyDown={resizeFromKeyboard}
                onPointerDown={(event) => {
                    draggingRef.current = true;
                    event.currentTarget.parentElement?.setPointerCapture(event.pointerId);
                }}
            />
            <div
                className="execution-plan-comparison-split-pane"
                style={{ flexBasis: `${(1 - ratio) * 100}%` }}>
                {second}
            </div>
        </div>
    );
}
