/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Injectable, Inject, forwardRef } from "@angular/core";

import { DataService } from "./data.service";

const keycodes = {
    "37": "left",
    "38": "up",
    "39": "right",
    "40": "down",
};
const displayCodes = {
    mac: {
        ctrl: "⌘",
        alt: "⌥",
        shift: "⇧",
    },
    windows: {
        ctrl: "Ctrl",
        alt: "Alt",
        shift: "Shift",
    },
    linux: {
        ctrl: "Ctrl",
        alt: "Alt",
        shift: "Shift",
    },
};

/**
 * Service which performs the http requests to get the data resultsets from the server.
 */

@Injectable()
export class ShortcutService {
    shortcuts: { [key: string]: string };
    private waitPromise: Promise<void>;

    constructor(
        @Inject(forwardRef(() => DataService)) private dataService: DataService,
        @Inject(forwardRef(() => Window)) private window: Window,
    ) {
        this.waitPromise = this.dataService.shortcuts.then((result) => {
            this.shortcuts = result;
        });
    }

    /**
     * determines the platform aware shortcut string for an event for display purposes
     * @param eventString The exact event string of the keycode you require (e.g event.toggleMessagePane)
     */
    stringCodeFor(eventString: string): Promise<string> {
        const self = this;
        if (this.shortcuts) {
            return Promise.resolve(this.stringCodeForInternal(eventString));
        } else {
            return new Promise<string>((resolve, reject) => {
                self.waitPromise.then(() => {
                    resolve(self.stringCodeForInternal(eventString));
                });
            });
        }
    }

    private stringCodeForInternal(eventString: string): string {
        let keyString = this.shortcuts[eventString];
        if (keyString) {
            let platString = this.window.navigator.platform;

            // find the current platform
            if (platString.match(/win/i)) {
                // iterate through the display replacement that are defined
                for (let key in displayCodes["windows"]) {
                    if (displayCodes["windows"].hasOwnProperty(key)) {
                        keyString = keyString.replace(key, displayCodes["windows"][key]);
                    }
                }
            } else if (platString.match(/linux/i)) {
                for (let key in displayCodes["linux"]) {
                    if (displayCodes["linux"].hasOwnProperty(key)) {
                        keyString = keyString.replace(key, displayCodes["linux"][key]);
                    }
                }
            } else if (platString.match(/mac/i)) {
                for (let key in displayCodes["mac"]) {
                    if (displayCodes["mac"].hasOwnProperty(key)) {
                        keyString = keyString.replace(key, displayCodes["mac"][key]);
                    }
                }
            }
            return keyString;
        }
    }

    async getEvent(shortcut: string): Promise<string> {
        if (this.shortcuts) {
            return this.getEventInternal(shortcut);
        } else {
            await this.waitPromise;
            return this.getEventInternal(shortcut);
        }
    }

    private getEventInternal(shortcut: string): string {
        for (let event in this.shortcuts) {
            if (this.shortcuts.hasOwnProperty(event)) {
                if (this.shortcuts[event] === shortcut) {
                    return event;
                }
            }
        }
        return undefined;
    }
    /**
     * Builds a event string of ctrl, shift, alt, and a-z + up, down, left, right
     * based on a passed Jquery event object, i.e 'ctrl+alt+t'
     * @param e The Jquery event object to build the string from
     */
    buildEventString(e): string {
        let resString = "";
        resString += e.ctrlKey || e.metaKey ? "ctrl+" : "";
        resString += e.altKey ? "alt+" : "";
        resString += e.shiftKey ? "shift+" : "";
        resString +=
            e.which >= 65 && e.which <= 90 ? String.fromCharCode(e.which) : keycodes[e.which];
        return resString;
    }
}
