/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

type EventMap = {
    [event: string]: (...args: any[]) => void;
};

export class TypedEventEmitter<Events extends EventMap> {
    private listeners: {
        [K in keyof Events]?: Events[K][];
    } = {};

    on<K extends keyof Events>(event: K, listener: Events[K]) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event]!.push(listener);
    }

    off<K extends keyof Events>(event: K, listener: Events[K]) {
        this.listeners[event] = this.listeners[event]?.filter((l) => l !== listener);
    }

    emit<K extends keyof Events>(event: K, ...args: Parameters<Events[K]>) {
        this.listeners[event]?.forEach((listener) => listener(...args));
    }

    once<K extends keyof Events>(event: K, listener: Events[K]) {
        const onceWrapper: Events[K] = ((...args: Parameters<Events[K]>) => {
            this.off(event, onceWrapper);
            listener(...args);
        }) as Events[K];
        this.on(event, onceWrapper);
    }
}
