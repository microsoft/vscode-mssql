/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Utils from "./utils";
import { sanitize, shorten } from "./logger";

export const logger2OutputChannelName = "MSSQL - Enhanced Logs";

/**
 * VS Code log-channel-style logger with support for MSSQL tracing and PII settings.
 */
export interface ILogger2 {
    /** Logs a message at the most verbose level. */
    trace(message: string, ...args: unknown[]): void;
    /** Logs a message when `mssql.tracingLevel` is `Verbose` or more permissive. */
    debug(message: string, ...args: unknown[]): void;
    /** Logs a message when `mssql.tracingLevel` is `Information` or more permissive. */
    info(message: string, ...args: unknown[]): void;
    /** Logs a message when `mssql.tracingLevel` is `Warning` or more permissive. */
    warn(message: string, ...args: unknown[]): void;
    /** Logs a message when `mssql.tracingLevel` is `Error` or more permissive. */
    error(message: string, ...args: unknown[]): void;
    /**
     * Logs a message containing sensitive values after applying the legacy MSSQL sanitization rules.
     * This is gated by `mssql.piiLogging` and intentionally bypasses tracing-level filtering.
     */
    piiSanitized(
        msg: unknown,
        objsToSanitize: { name: string; objOrArray: unknown | unknown[] }[],
        stringsToShorten: { name: string; value: string }[],
        ...vals: unknown[]
    ): void;
    /** Reveals the underlying log channel in VS Code. */
    show(preserveFocus?: boolean): void;
    /** Creates a lightweight logger view that prepends the given prefix to messages. */
    withPrefix(prefix: string): ILogger2;
    /** Disposes the owned channel, if this logger created one. */
    dispose(): void;
}

type LogMethod = "trace" | "debug" | "info" | "warn" | "error";
type ChannelFactory = () => vscode.LogOutputChannel;

interface Logger2ChannelState {
    ownsChannel: boolean;
    cachedChannel?: vscode.LogOutputChannel;
    createChannel: ChannelFactory;
}

let defaultChannel: vscode.LogOutputChannel | undefined;

/**
 * Returns the shared MSSQL log channel, creating it on first use.
 */
function getDefaultChannel(): vscode.LogOutputChannel {
    defaultChannel ??= vscode.window.createOutputChannel(logger2OutputChannelName, {
        log: true,
    });
    return defaultChannel;
}

/**
 * Converts arbitrary log values into a single-line string payload.
 */
function formatLogPart(value: unknown): string {
    if (value instanceof Error) {
        return value.stack ?? value.message;
    }

    if (typeof value === "string") {
        return value;
    }

    try {
        return JSON.stringify(value);
    } catch {
        return String(value);
    }
}

/**
 * Logger implementation backed by a VS Code `LogOutputChannel`.
 */
export class Logger2 implements ILogger2 {
    private constructor(
        private readonly _channelState: Logger2ChannelState,
        private readonly _prefix?: string,
    ) {}

    /**
     * Creates a logger backed by the shared MSSQL output channel.
     */
    public static global(prefix?: string): Logger2 {
        return new Logger2(
            {
                createChannel: getDefaultChannel,
                ownsChannel: false,
            },
            prefix,
        );
    }

    /**
     * Creates a logger backed by an existing log channel.
     */
    public static forChannel(channel: vscode.LogOutputChannel, prefix?: string): Logger2 {
        return new Logger2(
            {
                createChannel: () => channel,
                ownsChannel: false,
            },
            prefix,
        );
    }

    /**
     * Creates a logger that owns a dedicated log channel with the given name.
     */
    public static forChannelName(channelName: string, prefix?: string): Logger2 {
        return new Logger2(
            {
                createChannel: () => vscode.window.createOutputChannel(channelName, { log: true }),
                ownsChannel: true,
            },
            prefix,
        );
    }

    /** @inheritdoc */
    public trace(message: string, ...args: unknown[]): void {
        this.log("trace", message, ...args);
    }

    /** @inheritdoc */
    public debug(message: string, ...args: unknown[]): void {
        this.log("debug", message, ...args);
    }

    /** @inheritdoc */
    public info(message: string, ...args: unknown[]): void {
        this.log("info", message, ...args);
    }

    /** @inheritdoc */
    public warn(message: string, ...args: unknown[]): void {
        this.log("warn", message, ...args);
    }

    /** @inheritdoc */
    public error(message: string, ...args: unknown[]): void {
        this.log("error", message, ...args);
    }

    /** @inheritdoc */
    public piiSanitized(
        msg: unknown,
        objsToSanitize: { name: string; objOrArray: unknown | unknown[] }[],
        stringsToShorten: { name: string; value: string }[],
        ...vals: unknown[]
    ): void {
        if (!Utils.getConfigPiiLogging()) {
            return;
        }

        const sanitizedMessage = [
            formatLogPart(msg),
            ...(objsToSanitize ?? []).map((obj) => `${obj.name}=${sanitize(obj.objOrArray)}`),
            ...(stringsToShorten ?? []).map((str) => `${str.name}=${shorten(str.value)}`),
        ]
            .filter((part) => part.length > 0)
            .join(" ");

        this.channel.trace(this.formatMessage(`[PII] ${sanitizedMessage}`, vals));
    }

    /** @inheritdoc */
    public show(preserveFocus?: boolean): void {
        this.channel.show(preserveFocus);
    }

    /** @inheritdoc */
    public withPrefix(prefix: string): Logger2 {
        return new Logger2(this._channelState, prefix);
    }

    /** @inheritdoc */
    public dispose(): void {
        if (this._channelState.ownsChannel && this._channelState.cachedChannel) {
            this._channelState.cachedChannel.dispose();
            this._channelState.cachedChannel = undefined;
        }
    }

    private get channel(): vscode.LogOutputChannel {
        this._channelState.cachedChannel ??= this._channelState.createChannel();
        return this._channelState.cachedChannel;
    }

    private log(method: LogMethod, message: string, ...args: unknown[]): void {
        const formatted = this.formatMessage(message, args);

        switch (method) {
            case "trace":
                this.channel.trace(formatted);
                break;
            case "debug":
                this.channel.debug(formatted);
                break;
            case "info":
                this.channel.info(formatted);
                break;
            case "warn":
                this.channel.warn(formatted);
                break;
            case "error":
                this.channel.error(formatted);
                break;
        }
    }

    /**
     * Formats a message and optional arguments into the final emitted log payload.
     */
    private formatMessage(message: string, args: unknown[]): string {
        const formattedArgs = args.map((arg) => formatLogPart(arg)).filter((arg) => arg.length > 0);
        const payload = [message, ...formattedArgs].filter((part) => part.length > 0).join(" ");

        if (!this._prefix) {
            return payload;
        }

        return payload.length > 0 ? `[${this._prefix}] ${payload}` : `[${this._prefix}]`;
    }
}

/**
 * Shared MSSQL logger instance for callers that do not need a custom channel or prefix.
 */
export const logger2: ILogger2 = Logger2.global();

export default logger2;

/**
 * Exported for unit tests to isolate the cached default channel.
 */
export function resetLogger2DefaultChannelForTest(): void {
    defaultChannel = undefined;
}
