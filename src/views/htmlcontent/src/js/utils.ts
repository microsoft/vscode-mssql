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
export function parseTimeString(value: string): number {
    let tempVal = value.split('.');
    let ms = parseInt(tempVal[1].substring(0, 3), 10);
    tempVal = tempVal[0].split(':');
    let h = parseInt(tempVal[0], 10);
    let m = parseInt(tempVal[1], 10);
    let s = parseInt(tempVal[2], 10);
    return ms + (h * 3.6e6) + (m * 60000) + (s * 1000);
}

export function parseNumAsTimeString(value: number): string {
    let tempVal = value;
    let h = Math.floor(tempVal / 3.6e6);
    tempVal %= 3.6e6;
    let m = Math.floor(tempVal / 60000);
    tempVal %= 60000;
    let s = Math.floor(tempVal / 1000);
    tempVal %= 1000;

    let hs = h < 10 ? '0' + h : '' + h;
    let ms = m < 10 ? '0' + m : '' + m;
    let ss = s < 10 ? '0' + s : '' + s;

    let rs = hs + ':' + ms + ':' + ss;

    return tempVal > 0 ? rs + '.' + tempVal : rs;
}
