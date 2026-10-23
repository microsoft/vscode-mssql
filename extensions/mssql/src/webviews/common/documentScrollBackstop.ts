/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio / pinned-results shells own ALL scrolling through inner pane
 * scrollers — the document itself (html, body, #root) must never scroll.
 * Every container on that chain clips, but clipped (`overflow: hidden`)
 * boxes are still programmatically scrollable: a `focus()` reveal or
 * `scrollIntoView()` targeting content that overflows a mis-sized pane
 * scrolls the whole shell, shifting the toolbar/editor out of view and
 * leaving dead space under the status bar.
 *
 * This backstop pins the document chain at 0 and reports the first few
 * violations (which element moved, how far, and what held focus — the
 * likely reveal target) so field reports carry the culprit instead of a
 * screenshot of the aftermath.
 */

export interface DocumentScrollViolation {
    /** Which element scrolled: "scrollingElement" | "body" | "root". */
    readonly element: string;
    readonly scrollTop: number;
    readonly scrollLeft: number;
    /** tagName/id/className of document.activeElement (our own DOM, no user data). */
    readonly activeElement: string;
}

const MAX_REPORTS = 3;

function describeActiveElement(): string {
    const active = document.activeElement;
    if (!active || active === document.body) {
        return "body";
    }
    const id = active.id ? `#${active.id}` : "";
    const className =
        typeof active.className === "string" && active.className.length > 0
            ? `.${active.className.split(/\s+/).slice(0, 3).join(".")}`
            : "";
    return `${active.tagName.toLowerCase()}${id}${className}`.slice(0, 200);
}

/**
 * Installs scroll listeners on the document chain; returns a disposer.
 * Any non-zero scroll is reset to 0 and reported (rate-limited).
 */
export function installDocumentScrollBackstop(
    report: (violation: DocumentScrollViolation) => void,
): () => void {
    const targets: Array<{ name: string; element: Element | null }> = [
        { name: "scrollingElement", element: document.scrollingElement },
        { name: "body", element: document.body },
        { name: "root", element: document.getElementById("root") },
    ];
    let reports = 0;
    const settle = () => {
        for (const target of targets) {
            const element = target.element;
            if (!element) {
                continue;
            }
            const { scrollTop, scrollLeft } = element;
            if (scrollTop !== 0 || scrollLeft !== 0) {
                if (reports < MAX_REPORTS) {
                    reports++;
                    report({
                        element: target.name,
                        scrollTop,
                        scrollLeft,
                        activeElement: describeActiveElement(),
                    });
                }
                element.scrollTop = 0;
                element.scrollLeft = 0;
            }
        }
    };
    // Document-level scrolls fire on window; element scrolls don't bubble,
    // so body and #root get their own listeners.
    window.addEventListener("scroll", settle, { passive: true });
    const elementTargets = targets
        .map((target) => target.element)
        .filter((element): element is Element => element !== null);
    for (const element of elementTargets) {
        element.addEventListener("scroll", settle, { passive: true });
    }
    // Catch anything that scrolled before installation.
    settle();
    return () => {
        window.removeEventListener("scroll", settle);
        for (const element of elementTargets) {
            element.removeEventListener("scroll", settle);
        }
    };
}
