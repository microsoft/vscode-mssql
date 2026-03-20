/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogOutputChannel, OutputChannel } from "vscode";
import * as Constants from "../constants/constants";
import { ILogger } from "./interfaces";
import * as Utils from "./utils";
import { ILogger2, Logger2, logger2, sanitize, shorten } from "./logger2";

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
 * Logger keeps the legacy API surface while delegating output to Logger2.
 */
export class Logger implements ILogger {
    private _indentLevel: number = 0;
    private _indentSize: number = 4;
    private _logger2: ILogger2;

    constructor(
        _writer: (message: string) => void,
        _logLevel: LogLevel,
        private _piiLogging: boolean,
        prefix?: string,
    ) {
        this._logger2 = prefix ? logger2.withPrefix(prefix) : logger2;
    }

    public static create(channel: OutputChannel, prefix?: string): Logger {
        const logger = new Logger(
            () => undefined,
            LogLevel.All,
            Utils.getConfigPiiLogging(),
            prefix,
        );
        logger._logger2 = logger.createLogger2(channel, prefix);
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
        if (!this.piiLogging) {
            return;
        }

        const sanitizedMessage = [
            msg,
            ...objsToSanitize?.map((obj) => `${obj.name}=${sanitize(obj.objOrArray)}`),
            ...stringsToShorten.map((str) => `${str.name}=${shorten(str.value)}`),
        ].join(" ");

        this._logger2.trace(this.applyIndent(`[PII] ${sanitizedMessage}`), ...vals);
    }

    /**
     * Logs a message containing PII (when enabled).
     * @param msg The initial message to log
     * @param vals Any other values to add on to the end of the log message
     */
    public pii(msg: any, ...vals: any[]): void {
        if (!this.piiLogging) {
            return;
        }

        this._logger2.trace(this.applyIndent(`[PII] ${String(msg)}`), ...vals);
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
        this._logger2.debug(this.applyIndent(message));
    }

    public critical(msg: any, ...vals: any[]): void {
        this._logger2.error(this.applyIndent(String(msg)), ...vals);
    }

    public error(msg: any, ...vals: any[]): void {
        this._logger2.error(this.applyIndent(String(msg)), ...vals);
    }

    public warn(msg: any, ...vals: any[]): void {
        this._logger2.warn(this.applyIndent(String(msg)), ...vals);
    }

    public info(msg: any, ...vals: any[]): void {
        this._logger2.info(this.applyIndent(String(msg)), ...vals);
    }

    public verbose(msg: any, ...vals: any[]): void {
        this._logger2.debug(this.applyIndent(String(msg)), ...vals);
    }

    /** Outputs a message with priority "All" (most verbose) */
    public log(msg: any, ...vals: any[]): void {
        this._logger2.trace(this.applyIndent(String(msg)), ...vals);
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
        this._logger2.trace(this.applyIndent(message || ""));
    }

    /** Prints a message directly, regardless of log level */
    public appendLine(message?: string): void {
        this._logger2.info(this.applyIndent(message || ""));
    }

    private applyIndent(message: string): string {
        if (this._indentLevel <= 0 || message.length === 0) {
            return message;
        }

        return `${" ".repeat(this._indentLevel * this._indentSize)}${message}`;
    }

    private createLogger2(channel: OutputChannel, prefix?: string): ILogger2 {
        if (channel.name === Constants.outputChannelName) {
            return prefix ? logger2.withPrefix(prefix) : logger2;
        }

        const maybeLogChannel = channel as OutputChannel &
            Partial<Pick<ILogger2, "trace" | "debug" | "info" | "warn" | "error">>;
        if (
            typeof maybeLogChannel.trace === "function" &&
            typeof maybeLogChannel.debug === "function" &&
            typeof maybeLogChannel.info === "function" &&
            typeof maybeLogChannel.warn === "function" &&
            typeof maybeLogChannel.error === "function"
        ) {
            return Logger2.forChannel(maybeLogChannel as LogOutputChannel, prefix);
        }

        return Logger2.forChannelName(channel.name, prefix);
    }
}

export { sanitize, shorten } from "./logger2";
