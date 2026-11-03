/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { KeyboardEvent, PointerEvent, RefObject, useRef, useState } from "react";

const useStyles = makeStyles({
    // A wide hit area with a thin line in the middle, which shows on hover, focus, and drag.
    splitter: {
        position: "relative",
        cursor: "col-resize",
        touchAction: "none",
        outline: "none",
        "::after": {
            content: '""',
            position: "absolute",
            top: 0,
            bottom: 0,
            left: "50%",
            width: "2px",
            transform: "translateX(-50%)",
            borderRadius: "1px",
            backgroundColor: "transparent",
        },
        ":hover::after": {
            backgroundColor: tokens.colorNeutralStroke1Hover,
        },
        ":focus-visible::after": {
            backgroundColor: tokens.colorStrokeFocus2,
        },
    },
    dragging: {
        "::after": {
            backgroundColor: tokens.colorBrandStroke1,
        },
    },
});

export interface SideWidthLimits {
    /** The narrowest the side panel gets. */
    readonly min: number;
    /** The widest the side panel gets, as a share of the container. */
    readonly maxShare: number;
    /** The room that the main content keeps at least. */
    readonly mainMin: number;
}

/** The step of an arrow key, in pixels. */
const keyStep = 16;

/** Reads a remembered width. The storage can be missing or blocked, so it is only a convenience. */
function readStoredWidth(key: string): number | undefined {
    try {
        const value = Number(window.localStorage.getItem(key));
        return Number.isFinite(value) && value > 0 ? value : undefined;
    } catch {
        return undefined;
    }
}

function storeWidth(key: string, width: number | undefined): void {
    try {
        if (width === undefined) {
            window.localStorage.removeItem(key);
        } else {
            window.localStorage.setItem(key, String(Math.round(width)));
        }
    } catch {
        // The width stays for this session only.
    }
}

/**
 * The width of a side panel that the user resizes, remembered in the webview's storage.
 * Undefined is the default width, which the layout sets. `clamp` keeps a width within the limits
 * of the container's current width.
 */
export function useSideWidth(
    storageKey: string,
    container: RefObject<HTMLElement | null>,
    limits: SideWidthLimits,
) {
    const [width, setWidth] = useState<number | undefined>(() => readStoredWidth(storageKey));
    const clamp = (next: number) => {
        const total = container.current?.getBoundingClientRect().width ?? 0;
        const max = total > 0 ? Math.min(total * limits.maxShare, total - limits.mainMin) : next;
        return Math.round(Math.max(limits.min, Math.min(max, next)));
    };
    return {
        /** The width within the limits now, or undefined for the default. */
        width: width === undefined ? undefined : clamp(width),
        clamp,
        set: (next: number | undefined) => {
            const value = next === undefined ? undefined : clamp(next);
            setWidth(value);
            storeWidth(storageKey, value);
        },
    };
}

export interface SplitterProps {
    readonly className?: string;
    readonly label: string;
    /** The side panel's width now, measured when the drag starts if it is the default. */
    readonly width: number | undefined;
    readonly measure: () => number;
    readonly min: number;
    readonly max: () => number;
    /** The side panel is on the right, so dragging left makes it wider. */
    onResize(width: number | undefined): void;
}

/**
 * A vertical divider between the main content and a side panel on its right. Drag it, or focus it
 * and use the arrow keys, to resize the panel; double-click it to go back to the default width.
 */
export const Splitter = ({
    className,
    label,
    width,
    measure,
    min,
    max,
    onResize,
}: SplitterProps) => {
    const classes = useStyles();
    const drag = useRef<{ startX: number; startWidth: number } | undefined>(undefined);
    const [dragging, setDragging] = useState(false);
    const current = () => width ?? measure();

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { startX: event.clientX, startWidth: current() };
        setDragging(true);
    };
    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current) {
            onResize(drag.current.startWidth - (event.clientX - drag.current.startX));
        }
    };
    const onPointerEnd = (event: PointerEvent<HTMLDivElement>) => {
        if (drag.current) {
            event.currentTarget.releasePointerCapture(event.pointerId);
            drag.current = undefined;
            setDragging(false);
        }
    };
    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        const steps: Record<string, number> = {
            ArrowLeft: keyStep,
            ArrowRight: -keyStep,
        };
        if (event.key in steps) {
            event.preventDefault();
            onResize(current() + steps[event.key]);
        } else if (event.key === "Home") {
            event.preventDefault();
            onResize(max());
        } else if (event.key === "End") {
            event.preventDefault();
            onResize(min);
        }
    };

    return (
        <div
            role="separator"
            aria-orientation="vertical"
            aria-label={label}
            aria-valuemin={min}
            aria-valuemax={Math.round(max())}
            aria-valuenow={Math.round(current())}
            tabIndex={0}
            className={mergeClasses(classes.splitter, dragging && classes.dragging, className)}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onDoubleClick={() => onResize(undefined)}
            onKeyDown={onKeyDown}
        />
    );
};
