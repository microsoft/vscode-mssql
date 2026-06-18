/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const gridMenuButtonSelector = ".slick-grid-menu-button";

export function makeFluentResultGridMenuButtonsUntabbable(containerNode: HTMLElement): void {
    containerNode.querySelectorAll<HTMLElement>(gridMenuButtonSelector).forEach((button) => {
        button.tabIndex = -1;
    });
}

export function isEditableFluentResultGridKeyboardTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) {
        return false;
    }

    if (target.isContentEditable) {
        return true;
    }

    const tagName = target.tagName.toLowerCase();
    return tagName === "input" || tagName === "select" || tagName === "textarea";
}

export function toFluentResultGridAnchorRect(rect: DOMRect) {
    return {
        top: rect.top,
        left: rect.left,
        bottom: rect.bottom,
        right: rect.right,
        width: rect.width,
        height: rect.height,
    };
}
