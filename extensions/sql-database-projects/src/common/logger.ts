/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// NOTE: This file should always be kept in sync with the equivalent in the MSSQL extension:
// extensions/mssql/src/models/logger.ts

import * as os from "os";
import { OutputChannel } from "vscode";

// Inlined from extensions/mssql/src/models/interfaces.ts - keep in sync.
export interface ILogger {
    logDebug(message: string): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    verbose(msg: any, ...vals: any[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    warn(msg: any, ...vals: any[]): void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    error(msg: any, ...vals: any[]): void;
    piiSanitized(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        msg: any,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        objsToSanitize: { name: string; objOrArray: any | any[] }[],
        stringsToShorten: { name: string; value: string }[],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...vals: any[]
    ): void;
    increaseIndent(): void;
    decreaseIndent(): void;
    append(message?: string): void;
    appendLine(message?: string): void;
}

/**
 * Logger levels, ordered from most critical to most verbose.
 * Matches the subset used by sql-database-projects build tooling.
 */
export enum LogLevel {
    Error = 0,
    Warning = 1,
    Information = 2,
    Verbose = 3,
}

/**
 * Logger that writes formatted, timestamped messages to a VS Code OutputChannel.
 * Implements ILogger so it can be passed directly to HttpClient / HttpClientCore.
 *
 * During build operations the log level is always set to Verbose so that proxy
 * diagnostic messages are visible in the "Database Projects" output channel.
 */
export class Logger implements ILogger {
    private _indentLevel: number = 0;
    private _indentSize: number = 4;
    private _atLineStart: boolean = true;

    constructor(
        private readonly _writer: (message: string) => void,
        private readonly _logLevel: LogLevel = LogLevel.Verbose,
        private readonly _prefix?: string,
    ) {}

    /**
     * Creates a Logger that appends to the given OutputChannel.
     * The log level is always Verbose so all proxy/HTTP diagnostics are shown.
     */
    public static create(channel: OutputChannel, prefix?: string): Logger {
        return new Logger((msg) => channel.append(msg), LogLevel.Verbose, prefix);
    }

    /**
     * PII-sanitized logging — no-op in sql-database-projects.
     * Build tooling doesn't handle user credentials or sensitive tokens.
     */

    public piiSanitized(
        _msg: any,
        _objsToSanitize: any[],
        _stringsToShorten: any[],
        ..._vals: any[]
    ): void {
        // intentional no-op: sqlproj build tooling does not log PII
    }

    public logDebug(message: string): void {
        this.write(LogLevel.Verbose, message);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public verbose(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Verbose, msg, ...vals);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public warn(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Warning, msg, ...vals);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    public error(msg: any, ...vals: any[]): void {
        this.write(LogLevel.Error, msg, ...vals);
    }

    public increaseIndent(): void {
        this._indentLevel += 1;
    }

    public decreaseIndent(): void {
        if (this._indentLevel > 0) {
            this._indentLevel -= 1;
        }
    }

    public append(message?: string): void {
        this.appendCore(message ?? "");
    }

    public appendLine(message?: string): void {
        this.appendCore((message ?? "") + os.EOL);
        this._atLineStart = true;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private write(logLevel: LogLevel, msg: any, ...vals: any[]): void {
        if (logLevel <= this._logLevel) {
            let fullMessage = `[${LogLevel[logLevel]}]: ${msg}`;
            if (vals.length > 0) {
                fullMessage += ` - ${vals.map((v) => JSON.stringify(v)).join(" - ")}`;
            }
            this.appendLine(fullMessage);
        }
    }

    private appendCore(message: string): void {
        if (this._atLineStart) {
            if (this._indentLevel > 0) {
                this._writer(" ".repeat(this._indentLevel * this._indentSize));
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
