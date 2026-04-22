/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

interface SlickGridEditorLock {
    isActive?: () => boolean;
    commitCurrentEdit?: () => boolean;
}

interface SlickGridLike {
    getContainerNode?: () => HTMLElement | undefined;
    getEditorLock?: () => SlickGridEditorLock | undefined;
}

interface SlickGridKeyboardEventData {
    altKey?: boolean;
    ctrlKey?: boolean;
    key?: string;
    shiftKey?: boolean;
    getNativeEvent?: () => KeyboardEvent | undefined;
    isImmediatePropagationStopped?: () => boolean;
    stopImmediatePropagation?: () => void;
}

interface SlickGridKeyDownEventDetail {
    args?: {
        grid?: SlickGridLike;
    };
    eventData?: SlickGridKeyboardEventData;
}

const focusableElementSelector = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "details > summary:first-of-type",
    "[contenteditable='true']",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

function isFocusableElement(element: HTMLElement): boolean {
    if (element.closest("[inert]")) {
        return false;
    }

    if ((element as HTMLButtonElement).disabled || element.getAttribute("aria-hidden") === "true") {
        return false;
    }

    const style = window.getComputedStyle(element);
    return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        element.getClientRects().length > 0
    );
}

function findAdjacentFocusableElement(
    gridContainer: HTMLElement,
    focusPrevious: boolean,
): HTMLElement | undefined {
    const root = gridContainer.getRootNode() as Document | ShadowRoot;
    const focusableElements = Array.from(
        root.querySelectorAll<HTMLElement>(focusableElementSelector),
    ).filter(isFocusableElement);

    const gridElementIndexes = focusableElements.reduce<number[]>((indexes, element, index) => {
        if (gridContainer.contains(element)) {
            indexes.push(index);
        }
        return indexes;
    }, []);

    if (gridElementIndexes.length > 0) {
        const boundaryIndex = focusPrevious
            ? gridElementIndexes[0] - 1
            : gridElementIndexes[gridElementIndexes.length - 1] + 1;

        for (
            let index = boundaryIndex;
            focusPrevious ? index >= 0 : index < focusableElements.length;
            index += focusPrevious ? -1 : 1
        ) {
            const candidate = focusableElements[index];
            if (candidate && !gridContainer.contains(candidate)) {
                return candidate;
            }
        }

        return undefined;
    }

    return focusPrevious
        ? focusableElements
              .slice()
              .reverse()
              .find(
                  (element) =>
                      Boolean(
                          element.compareDocumentPosition(gridContainer) &
                              Node.DOCUMENT_POSITION_FOLLOWING,
                      ) && !gridContainer.contains(element),
              )
        : focusableElements.find(
              (element) =>
                  Boolean(
                      gridContainer.compareDocumentPosition(element) &
                          Node.DOCUMENT_POSITION_FOLLOWING,
                  ) && !gridContainer.contains(element),
          );
}

function focusAdjacentElementOutsideGrid(gridContainer: HTMLElement, focusPrevious: boolean): void {
    findAdjacentFocusableElement(gridContainer, focusPrevious)?.focus();
}

export function handleFluentSlickGridTabNavigation(
    event: CustomEvent<SlickGridKeyDownEventDetail>,
    gridContainer: HTMLElement | undefined,
): void {
    const eventData = event.detail.eventData;
    const nativeEvent = eventData?.getNativeEvent?.();
    const keyboardEvent = nativeEvent ?? eventData;
    if (
        keyboardEvent?.key !== "Tab" ||
        keyboardEvent.ctrlKey ||
        keyboardEvent.altKey ||
        eventData?.isImmediatePropagationStopped?.() ||
        !eventData?.stopImmediatePropagation
    ) {
        return;
    }

    const grid = event.detail.args?.grid;
    const editorLock = grid?.getEditorLock?.();
    eventData.stopImmediatePropagation();

    if (editorLock?.isActive?.() && !editorLock.commitCurrentEdit?.()) {
        return;
    }

    const currentGridContainer = gridContainer ?? grid?.getContainerNode?.();
    if (currentGridContainer) {
        focusAdjacentElementOutsideGrid(currentGridContainer, keyboardEvent.shiftKey ?? false);
    }
}
