/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import { ILogger } from "./interfaces";
import * as Utils from "./utils";
import { OutputChannel } from "vscode";

/** Logger levels, ordered from most critical to most verbose */
export enum LogLevel {
    Pii = 0,
    Off = 1,
    Critical = 2,
    Error = 3,
    Warning = 4,
    Information = 5,
    Verbose = 6,
    All = 7,
}

/*
 * Logger class handles logging messages using the Util functions.
 */
export class Logger implements ILogger {
    private _indentLevel: number = 0;
    private _indentSize: number = 4;
    private _atLineStart: boolean = true;

    constructor(
        private _writer: (message: string) => void,
        private _logLevel: LogLevel,
        private _piiLogging: boolean,
        private _prefix?: string,
    ) {}

    public static create(channel: OutputChannel, prefix?: string): Logger {
        const logLevel: LogLevel = LogLevel[Utils.getConfigTracingLevel() as keyof typeof LogLevel];
        const pii = Utils.getConfigPiiLogging();

        function logToOutputChannel(message: string): void {
            channel.append(message);
        }

        const logger = new Logger(logToOutputChannel, logLevel, pii, prefix);

        return logger;
    }

    /**
     * Logs a message containing PII (when enabled). Provides the ability to sanitize or shorten values to hide information or reduce the amount logged.
     * @param msg The initial message to log
     * @param objsToSanitize Set of objects we want to sanitize
     * @param stringsToShorten Set of strings to shorten
     * @param vals Any other values to add on to the end of the log message
     */
    public piiSanitized(
        msg: any,
        objsToSanitize: { name: string; objOrArray: any | any[] }[],
        stringsToShorten: { name: string; value: string }[],
        ...vals: any[]
    ): void {
        if (this.piiLogging) {
            msg = [
                msg,
                ...objsToSanitize?.map((obj) => `${obj.name}=${sanitize(obj.objOrArray)}`),
                ...stringsToShorten.map((str) => `${str.name}=${shorten(str.value)}`),
            ].join(" ");
            this.write(LogLevel.Pii, msg, ...vals);
        }
    }

    /**
     * Logs a message containing PII (when enabled).
     * @param msg The initial message to log
     * @param vals Any other values to add on to the end of the log message
     */
    public pii(msg: any, ...vals: any[]): void {
        if (this.piiLogging) {
            this.write(LogLevel.Pii, msg, ...vals);
        }
    }

    public set piiLogging(val: boolean) {
        this._piiLogging = val;
    }

    public get piiLogging(): boolean {
        return this._piiLogging;
    }

    /**
     * Prints at the `verbose` level.
     * If `mssql.logDebug` is enabled, prints the message to the developer console.
     **/
    public logDebug(message: string): void {
        Utils.logDebug(message);
        this.write(LogLevel.Verbose, message);
    }

    public critical(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Critical, msg, ...vals);
        console.error(msg);
    }

    public error(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Error, msg, ...vals);
        console.error(msg);
    }

    public warn(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Warning, msg, ...vals);
        console.warn(msg);
    }

    public info(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Information, msg, ...vals);
    }

    public verbose(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Verbose, msg, ...vals);
    }

    /** Outputs a message with priority "All" (most verbose) */
    public log(msg: any, ...vals: any[]): void {
        this.write(LogLevel.All, msg, ...vals);
    }

    public increaseIndent(): void {
        this._indentLevel += 1;
    }

    public decreaseIndent(): void {
        if (this._indentLevel > 0) {
            this._indentLevel -= 1;
        }
    }

    /** Prints a message directly, regardless of log level */
    public append(message?: string): void {
        message = message || "";
        this.appendCore(message);
    }

    /** Prints a message directly, regardless of log level */
    public appendLine(message?: string): void {
        message = message || "";
        this.appendCore(message + os.EOL);
        this._atLineStart = true;
    }

    private shouldLog(logLevel: LogLevel): Boolean {
        return logLevel <= this._logLevel;
    }

    private write(logLevel: LogLevel, msg: any, ...vals: any[]): void {
        if (this.shouldLog(logLevel) || logLevel === LogLevel.Pii) {
            let fullMessage = `[${LogLevel[logLevel]}]: ${msg}`;

            // if present, append additional values to the message
            if (vals.length > 0) {
                fullMessage += ` - ${vals.map((v) => JSON.stringify(v)).join(" - ")}`;
            }

            this.appendLine(fullMessage);
        }
    }

    private appendCore(message: string): void {
        if (this._atLineStart) {
            if (this._indentLevel > 0) {
                const indent = " ".repeat(this._indentLevel * this._indentSize);
                this._writer(indent);
            }

            this._writer(`[${new Date().toLocaleTimeString()}] `);

            if (this._prefix) {
                this._writer(`[${this._prefix}] `);
            }

            this._atLineStart = false;
        }

        this._writer(message);
    }
}

/**
 * Sanitizes a given object for logging to the output window, removing/shortening any PII or unneeded values
 * @param objOrArray The object to sanitize for output logging
 * @returns The stringified version of the sanitized object
 */
function sanitize(objOrArray: any): string {
    if (Array.isArray(objOrArray)) {
        return JSON.stringify(objOrArray.map((o) => sanitizeImpl(o)));
    } else {
        return sanitizeImpl(objOrArray);
    }
}

function sanitizeImpl(obj: any): string {
    obj = Object.assign({}, obj);
    delete obj.domains; // very long and not really useful
    // shorten all tokens since we don't usually need the exact values and there's security concerns if they leaked
    shortenIfExists(obj, "token");
    shortenIfExists(obj, "refresh_token");
    shortenIfExists(obj, "access_token");
    shortenIfExists(obj, "code");
    shortenIfExists(obj, "id_token");
    return JSON.stringify(obj);
}

/**
 * Shortens the given string property on an object if it exists, otherwise does nothing
 * @param obj The object possibly containing the property
 * @param property The name of the property to shorten - if it exists
 */
function shortenIfExists(obj: any, property: string): void {
    if (obj[property]) {
        obj[property] = shorten(obj[property]);
    }
}

/**
 * Shortens a given string - if it's longer than 6 characters will return the first 3 characters
 * followed by a ... followed by the last 3 characters. Returns the original string if 6 characters
 * or less.
 * @param str The string to shorten
 * @returns Shortened string in the form 'xxx...xxx'
 */
function shorten(str?: string): string | undefined {
    // Don't shorten if adding the ... wouldn't make the string shorter
    if (!str || str.length < 10) {
        return str;
    }
    return `${str.substr(0, 3)}...${str.slice(-3)}`;
}
