/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RefObject, useLayoutEffect, useState } from "react";

/** The height of an element, kept up to date as it resizes. */
export function useElementHeight(element: RefObject<HTMLElement | null>): number {
    const [height, setHeight] = useState(0);
    useLayoutEffect(() => {
        const target = element.current;
        if (!target) {
            return;
        }
        const measure = (next: number) =>
            setHeight((current) => (Math.abs(current - next) >= 1 ? Math.floor(next) : current));
        measure(target.getBoundingClientRect().height);
        const observer = new ResizeObserver((entries) => measure(entries[0].contentRect.height));
        observer.observe(target);
        return () => observer.disconnect();
    }, [element]);
    return height;
}
