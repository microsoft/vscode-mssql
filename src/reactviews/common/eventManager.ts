/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class EventManager {
    private eventListeners: {
        target: EventTarget;
        type: string;
        handler: EventListenerOrEventListenerObject;
    }[] = [];

    /** Method to add an event listener and track it */
    addEventListener(
        target: EventTarget,
        type: string,
        handler: EventListenerOrEventListenerObject,
    ): void {
        target.addEventListener(type, handler);
        this.eventListeners.push({ target, type, handler });
    }

    /** Method to remove all tracked event listeners */
    clearEventListeners(): void {
        for (const { target, type, handler } of this.eventListeners) {
            target.removeEventListener(type, handler);
        }
        this.eventListeners = []; // Clear the registry
    }
}
