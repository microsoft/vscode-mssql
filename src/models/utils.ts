'use strict';
import * as getmac from 'getmac';
import * as crypto from 'crypto';
import * as os from 'os';
import vscode = require('vscode');
import Constants = require('../constants/constants');
import * as interfaces from './interfaces';
import {ExtensionContext} from 'vscode';
import fs = require('fs');

// CONSTANTS //////////////////////////////////////////////////////////////////////////////////////
const msInH = 3.6e6;
const msInM = 60000;
const msInS = 1000;

// INTERFACES /////////////////////////////////////////////////////////////////////////////////////

// Interface for package.json information
export interface IPackageInfo {
    name: string;
    version: string;
    aiKey: string;
}

// FUNCTIONS //////////////////////////////////////////////////////////////////////////////////////

// Get information from the extension's package.json file
export function getPackageInfo(context: ExtensionContext): IPackageInfo {
    let extensionPackage = require(context.asAbsolutePath('./package.json'));
    if (extensionPackage) {
        return {
            name: extensionPackage.name,
            version: extensionPackage.version,
            aiKey: extensionPackage.aiKey
        };
    }
}

// Generate a new GUID
export function generateGuid(): string {
    let hexValues: string[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'A', 'B', 'C', 'D', 'E', 'F'];
    // c.f. rfc4122 (UUID version 4 = xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx)
    let oct: string = '';
    let tmp: number;
    /* tslint:disable:no-bitwise */
    for (let a: number = 0; a < 4; a++) {
        tmp = (4294967296 * Math.random()) | 0;
        oct +=  hexValues[tmp & 0xF] +
                hexValues[tmp >> 4 & 0xF] +
                hexValues[tmp >> 8 & 0xF] +
                hexValues[tmp >> 12 & 0xF] +
                hexValues[tmp >> 16 & 0xF] +
                hexValues[tmp >> 20 & 0xF] +
                hexValues[tmp >> 24 & 0xF] +
                hexValues[tmp >> 28 & 0xF];
    }

    // 'Set the two most significant bits (bits 6 and 7) of the clock_seq_hi_and_reserved to zero and one, respectively'
    let clockSequenceHi: string = hexValues[8 + (Math.random() * 4) | 0];
    return oct.substr(0, 8) + '-' + oct.substr(9, 4) + '-4' + oct.substr(13, 3) + '-' + clockSequenceHi + oct.substr(16, 3) + '-' + oct.substr(19, 12);
    /* tslint:enable:no-bitwise */
}

// Generate a unique, deterministic ID for the current user of the extension
export function generateUserId(): Promise<string> {
    return new Promise<string>(resolve => {
        try {
            getmac.getMac((error, macAddress) => {
                if (!error) {
                    resolve(crypto.createHash('sha256').update(macAddress + os.homedir(), 'utf8').digest('hex'));
                } else {
                    resolve(generateGuid()); // fallback
                }
            });
        } catch (err) {
            resolve(generateGuid()); // fallback
        }
    });
}

// Return 'true' if the active editor window has a .sql file, false otherwise
export function isEditingSqlFile(): boolean {
    let sqlFile = false;
    let editor = getActiveTextEditor();
    if (editor) {
        if (editor.document.languageId === Constants.languageId) {
            sqlFile = true;
        }
    }
    return sqlFile;
}

// Return the active text editor if there's one
export function getActiveTextEditor(): vscode.TextEditor {
    let editor = undefined;
    if (vscode.window && vscode.window.activeTextEditor) {
        editor = vscode.window.activeTextEditor;
    }
    return editor;
}

// Retrieve the URI for the currently open file if there is one; otherwise return the empty string
export function getActiveTextEditorUri(): string {
    if (typeof vscode.window.activeTextEditor !== 'undefined' &&
        typeof vscode.window.activeTextEditor.document !== 'undefined') {
        return vscode.window.activeTextEditor.document.uri.toString();
    }
    return '';
}

// Helper to log messages to "MSSQL" output channel
export function logToOutputChannel(msg: any): void {
    let outputChannel = vscode.window.createOutputChannel(Constants.outputChannelName);
    outputChannel.show();
    if (msg instanceof Array) {
        msg.forEach(element => {
            outputChannel.appendLine(element.toString());
        });
    } else {
        outputChannel.appendLine(msg.toString());
    }
}

// Helper to log debug messages
export function logDebug(msg: any): void {
    let config = vscode.workspace.getConfiguration(Constants.extensionConfigSectionName);
    let logDebugInfo = config[Constants.configLogDebugInfo];
    if (logDebugInfo === true) {
        let currentTime = new Date().toLocaleTimeString();
        let outputMsg = '[' + currentTime + ']: ' + msg ? msg.toString() : '';
        console.log(outputMsg);
    }
}

// Helper to show an info message
export function showInfoMsg(msg: string): void {
    vscode.window.showInformationMessage(Constants.extensionName + ': ' + msg );
}

// Helper to show an warn message
export function showWarnMsg(msg: string): void {
    vscode.window.showWarningMessage(Constants.extensionName + ': ' + msg );
}

// Helper to show an error message
export function showErrorMsg(msg: string): void {
    vscode.window.showErrorMessage(Constants.extensionName + ': ' + msg );
}

export function isEmpty(str: any): boolean {
    return (!str || '' === str);
}

export function isNotEmpty(str: any): boolean {
    return <boolean>(str && '' !== str);
}

export function authTypeToString(value: interfaces.AuthenticationTypes): string {
    return interfaces.AuthenticationTypes[value];
}

/**
 * Format a string. Behaves like C#'s string.Format() function.
 */
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
 * Compares 2 database names to see if they are the same.
 * If either is undefined or empty, it is assumed to be 'master'
 */
function isSameDatabase(currentDatabase: string, expectedDatabase: string): boolean {
    if (isEmpty(currentDatabase)) {
        currentDatabase = Constants.defaultDatabase;
    }
    if (isEmpty(expectedDatabase)) {
        expectedDatabase = Constants.defaultDatabase;
    }
    return currentDatabase === expectedDatabase;
}

/**
 * Compares 2 authentication type strings to see if they are the same.
 * If either is undefined or empty, then it is assumed to be SQL authentication by default.
 */
function isSameAuthenticationType(currentAuthenticationType: string, expectedAuthenticationType: string): boolean {
    if (isEmpty(currentAuthenticationType)) {
        currentAuthenticationType = Constants.sqlAuthentication;
    }
    if (isEmpty(expectedAuthenticationType)) {
        expectedAuthenticationType = Constants.sqlAuthentication;
    }
    return currentAuthenticationType === expectedAuthenticationType;
}

/**
 * Compares 2 profiles to see if they match. Logic for matching:
 * If a profile name is used, can simply match on this.
 * If not, match on all key properties (server, db, auth type, user) being identical.
 * Other properties are ignored for this purpose
 *
 * @param {IConnectionProfile} currentProfile the profile to check
 * @param {IConnectionProfile} expectedProfile the profile to try to match
 * @returns boolean that is true if the profiles match
 */
export function isSameProfile(currentProfile: interfaces.IConnectionProfile, expectedProfile: interfaces.IConnectionProfile): boolean {
    if (currentProfile === undefined) {
        return false;
    }
    if (expectedProfile.profileName) {
        // Can match on profile name
        return expectedProfile.profileName === currentProfile.profileName;
    } else if (currentProfile.profileName) {
        // This has a profile name but expected does not - can break early
        return false;
    }
    return expectedProfile.server === currentProfile.server
        && isSameDatabase(expectedProfile.database, currentProfile.database)
        && isSameAuthenticationType(expectedProfile.authenticationType, currentProfile.authenticationType)
        && expectedProfile.user === currentProfile.user;
}

/**
 * Compares 2 connections to see if they match. Logic for matching:
 * match on all key properties (server, db, auth type, user) being identical.
 * Other properties are ignored for this purpose
 *
 * @param {IConnectionCredentials} conn the connection to check
 * @param {IConnectionCredentials} expectedConn the connection to try to match
 * @returns boolean that is true if the connections match
 */
export function isSameConnection(conn: interfaces.IConnectionCredentials, expectedConn: interfaces.IConnectionCredentials): boolean {
    return expectedConn.server === conn.server
        && isSameDatabase(expectedConn.database, conn.database)
        && isSameAuthenticationType(expectedConn.authenticationType, conn.authenticationType)
        && expectedConn.user === conn.user;
}

/**
 * Check if a file exists on disk
 */
export function isFileExisting(filePath: string): boolean {
        try {
            fs.statSync(filePath);
            return true;
        } catch (err) {
            return false;
        }
    }


// One-time use timer for performance testing
export class Timer {
    private _startTime: number[];
    private _endTime: number[];

    constructor() {
        this.start();
    }

    // Get the duration of time elapsed by the timer, in milliseconds
    public getDuration(): number {
        if (!this._startTime) {
            return -1;
        } else if (!this._endTime) {
            let endTime = process.hrtime(this._startTime);
            return  endTime[0] * 1000 + endTime[1] / 1000000;
        } else {
            return this._endTime[0] * 1000 + this._endTime[1] / 1000000;
        }
    }

    public start(): void {
        this._startTime = process.hrtime();
    }

    public end(): void {
        if (!this._endTime) {
            this._endTime = process.hrtime(this._startTime);
        }
    }
}

/**
 * Takes a string in the format of HH:MM:SS.MS and returns a number representing the time in
 * miliseconds
 * @param value The string to convert to milliseconds
 * @return False is returned if the string is an invalid format,
 *         the number of milliseconds in the time string is returned otherwise.
 */
export function parseTimeString(value: string): number | boolean {
    if (!value) {
        return false;
    }
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

export function isBoolean(obj: any): obj is boolean {
    return obj === true || obj === false;
}

/**
 * Takes a number of milliseconds and converts it to a string like HH:MM:SS.fff
 * @param value The number of milliseconds to convert to a timespan string
 * @returns A properly formatted timespan string.
 */
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
    let mss = tempVal < 10 ? '00' + tempVal : tempVal < 100 ? '0' + tempVal : '' + tempVal;

    let rs = hs + ':' + ms + ':' + ss;

    return tempVal > 0 ? rs + '.' + mss : rs;
}
