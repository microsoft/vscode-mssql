/** Constants */
const msInH = 3.6e6;
const msInM = 60000;
const msInS = 1000;

const shortcuts = require('./shortcuts.json!');
const displayCodes = require('./displayCodes.json!');

export function formatString(str: string, ...args: any[]): string {
    // This is based on code originally from https://github.com/Microsoft/vscode/blob/master/src/vs/nls.js
    // License: https://github.com/Microsoft/vscode/blob/master/LICENSE.txt
    let result: string;
    if (args.length === 0) {
        result = str;
    } else {
        result = str.replace(/\{(\d+)\}/g, (match, rest) => {
            let index = rest[0];
            return typeof args[index] !== 'undefined' ? args[index] : match;
        });
    }
    return result;
}

/**
 * Takes a string in the format of HH:MM:SS.MS and returns
 * a number representing the time in miliseconds
 */
export function parseTimeString(value: string): number | boolean {
    let tempVal = value.split('.');

    if (tempVal.length !== 2) {
        return false;
    }

    let ms = parseInt(tempVal[1].substring(0, 3), 10);
    tempVal = tempVal[0].split(':');

    if (tempVal.length !== 3) {
        return false;
    }

    let h = parseInt(tempVal[0], 10);
    let m = parseInt(tempVal[1], 10);
    let s = parseInt(tempVal[2], 10);

    return ms + (h * msInH) + (m * msInM) + (s * msInS);
}

export function parseNumAsTimeString(value: number): string {
    let tempVal = value;
    let h = Math.floor(tempVal / msInH);
    tempVal %= msInH;
    let m = Math.floor(tempVal / msInM);
    tempVal %= msInM;
    let s = Math.floor(tempVal / msInS);
    tempVal %= msInS;

    let hs = h < 10 ? '0' + h : '' + h;
    let ms = m < 10 ? '0' + m : '' + m;
    let ss = s < 10 ? '0' + s : '' + s;

    let rs = hs + ':' + ms + ':' + ss;

    return tempVal > 0 ? rs + '.' + tempVal : rs;
}

/**
 * determines the platform away shortcut string for an event for display purposes
 * @param eventString The exact event string of the keycode you require (e.g event.toggleMessagePane)
 */
export function stringCodeFor(eventString: string): string {
    // iterate through all the known shortcuts
    for (let shortcut in shortcuts) {
        if (shortcuts.hasOwnProperty(shortcut)) {
            // if it matches the requested event
            if (shortcuts[shortcut] === eventString && shortcut !== 'undefined') {
                let keyString = shortcut;
                let platString = window.navigator.platform;

                // find the current platform
                if (platString.match(/win/i)) {
                    // iterate through the display replacement that are defined
                    for (let key in displayCodes['windows']) {
                        if (displayCodes['windows'].hasOwnProperty(key)) {
                            keyString = keyString.replace(key, displayCodes['windows'][key]);
                        }
                    }
                } else if (platString.match(/linux/i)) {
                    for (let key in displayCodes['linux']) {
                        if (displayCodes['linux'].hasOwnProperty(key)) {
                            keyString = keyString.replace(key, displayCodes['linux'][key]);
                        }
                    }
                } else if (platString.match(/mac/i)) {
                    for (let key in displayCodes['mac']) {
                        if (displayCodes['mac'].hasOwnProperty(key)) {
                            keyString = keyString.replace(key, displayCodes['mac'][key]);
                        }
                    }
                }
                return keyString;
            }
        }
    }
}
