/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { useCallback, useEffect, useRef, useState } from "react";

interface ResizableOptions {
    direction?: "vertical" | "horizontal" | "both";
    minHeight?: number;
    maxHeight?: number;
    initialHeight?: number;
    onResize?: (height: number) => void;
}

/**
 * A custom hook that provides resizing functionality for components
 */
export const useResizable = (options: ResizableOptions = {}) => {
    const { minHeight = 100, maxHeight, initialHeight = 200, onResize } = options;

    const [height, setHeight] = useState(initialHeight);
    const elementRef = useRef<HTMLDivElement>(null);
    const startPositionRef = useRef(0);
    const startHeightRef = useRef(0);
    const resizingRef = useRef(false);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            resizingRef.current = true;
            startPositionRef.current = e.clientY;
            startHeightRef.current = height;

            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        },
        [height],
    );

    const handleMouseMove = useCallback(
        (e: MouseEvent) => {
            if (!resizingRef.current) return;

            const deltaY = e.clientY - startPositionRef.current;
            let newHeight = startHeightRef.current + deltaY;

            if (minHeight) newHeight = Math.max(newHeight, minHeight);
            if (maxHeight) newHeight = Math.min(newHeight, maxHeight);

            setHeight(newHeight);
        },
        [minHeight, maxHeight],
    );

    // Separate effect to handle onResize callback and dispatch resize event
    useEffect(() => {
        if (onResize) {
            onResize(height);
        }

        // Dispatch a resize event to notify other components
        const resizeEvent = new Event("resize");
        window.dispatchEvent(resizeEvent);
    }, [height, onResize]);

    const handleMouseUp = useCallback(() => {
        if (!resizingRef.current) return;

        resizingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
    }, [handleMouseMove]);

    useEffect(() => {
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [handleMouseMove, handleMouseUp]);

    return {
        ref: elementRef,
        height,
        resizerProps: {
            onMouseDown: handleMouseDown,
            style: {
                cursor: "ns-resize",
                height: "6px",
                width: "100%",
                backgroundColor: "transparent",
                position: "absolute" as const,
                bottom: 0,
                left: 0,
            },
        },
    };
};
