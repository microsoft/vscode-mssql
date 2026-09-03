/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
    useCallback,
    useLayoutEffect,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
    type RefObject,
} from "react";

export interface LazyMountProps {
    children: ReactNode;
    className?: string;
    containerRef?: RefObject<HTMLDivElement | null>;
    enabled?: boolean;
    rootRef?: RefObject<Element | null>;
    style?: CSSProperties;
}

export function doLazyMountBoundsIntersect(element: Element, root: Element): boolean {
    const elementBounds = element.getBoundingClientRect();
    const rootBounds = root.getBoundingClientRect();
    return (
        elementBounds.bottom > rootBounds.top &&
        elementBounds.top < rootBounds.bottom &&
        elementBounds.right > rootBounds.left &&
        elementBounds.left < rootBounds.right
    );
}

/**
 * Preserves a container's layout while deferring its children until the container first becomes
 * visible. Unsupported or unavailable browser primitives fall back to rendering immediately.
 */
export function LazyMount({
    children,
    className,
    containerRef,
    enabled = true,
    rootRef,
    style,
}: LazyMountProps) {
    const [hasMounted, setHasMounted] = useState(!enabled);
    const hasMountedRef = useRef(hasMounted);
    const localContainerRef = useRef<HTMLDivElement | null>(null);
    const observerRef = useRef<IntersectionObserver | undefined>(undefined);

    const mountChildren = useCallback(() => {
        if (hasMountedRef.current) {
            return;
        }

        hasMountedRef.current = true;
        observerRef.current?.disconnect();
        observerRef.current = undefined;
        setHasMounted(true);
    }, []);

    const setContainer = useCallback(
        (element: HTMLDivElement | null) => {
            localContainerRef.current = element;
            if (containerRef) {
                containerRef.current = element;
            }
        },
        [containerRef],
    );

    useLayoutEffect(() => {
        observerRef.current?.disconnect();
        observerRef.current = undefined;

        if (hasMountedRef.current) {
            return;
        }

        const element = localContainerRef.current;
        const root = rootRef?.current;
        if (
            !enabled ||
            !element ||
            !root ||
            typeof globalThis.IntersectionObserver === "undefined"
        ) {
            mountChildren();
            return;
        }

        try {
            if (doLazyMountBoundsIntersect(element, root)) {
                mountChildren();
                return;
            }

            observerRef.current = new IntersectionObserver(
                (entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) {
                        mountChildren();
                    }
                },
                { root },
            );
            observerRef.current.observe(element);
        } catch {
            mountChildren();
        }

        return () => {
            observerRef.current?.disconnect();
        };
    }, [enabled, mountChildren, rootRef]);

    return (
        <div ref={setContainer} className={className} style={style}>
            {hasMounted ? children : null}
        </div>
    );
}
