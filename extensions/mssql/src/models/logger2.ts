/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as Utils from "./utils";

export const logger2OutputChannelName = Constants.outputChannelName;

/**
 * VS Code log-channel-style logger with support for MSSQL tracing and PII settings.
 */
export interface ILogger2 {
    /**
     * Logs a message at the most verbose level.
     * Visibility of the message is controlled by the VS Code log channel's configured log level.
     */
    trace(message: string, ...args: unknown[]): void;
    /**
     * Logs a message at the debug level to the underlying VS Code log channel.
     * Visibility of the message is controlled by the channel's configured log level.
     */
    debug(message: string, ...args: unknown[]): void;
    /**
     * Logs a message at the information level to the underlying VS Code log channel.
     * Visibility of the message is controlled by the channel's configured log level.
     */
    info(message: string, ...args: unknown[]): void;
    /**
     * Logs a message at the warning level to the underlying VS Code log channel.
     * Visibility of the message is controlled by the channel's configured log level.
     */
    warn(message: string, ...args: unknown[]): void;
    /**
     * Logs a message at the error level to the underlying VS Code log channel.
     * Visibility of the message is controlled by the channel's configured log level.
     */
    error(message: string, ...args: unknown[]): void;
    /**
     * Logs a message containing sensitive values after applying the legacy MSSQL sanitization rules.
     * Emission is gated by `mssql.piiLogging`, while visibility is controlled by the VS Code
     * log channel's configured log level.
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
const defaultChannelState: Logger2ChannelState = {
    createChannel: getDefaultChannel,
    ownsChannel: false,
};

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
 * Ensures a string is normalized to a single line by replacing newlines with spaces.
 */
function normalizeSingleLine(text: string): string {
    return text.replace(/[\r\n]+/g, " ").trim();
}

/**
 * Converts arbitrary log values into a single-line string payload.
 */
function formatLogPart(value: unknown): string {
    if (value instanceof Error) {
        return normalizeSingleLine(value.stack ?? value.message);
    }

    if (typeof value === "string") {
        return normalizeSingleLine(value);
    }

    try {
        const json = JSON.stringify(value);
        return json === undefined ? String(value) : normalizeSingleLine(json);
    } catch {
        return normalizeSingleLine(String(value));
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
        return new Logger2(defaultChannelState, prefix);
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
                console.warn(formatted);
                break;
            case "error":
                this.channel.error(formatted);
                console.error(formatted);
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
    defaultChannel?.dispose();
    defaultChannel = undefined;
    defaultChannelState.cachedChannel = undefined;
}

/**
 * Sanitizes a given object for logging to the output window, removing/shortening any PII or unneeded values.
 * @param objOrArray The object to sanitize for output logging
 * @returns The stringified version of the sanitized object
 */
export function sanitize(objOrArray: any): string {
    if (Array.isArray(objOrArray)) {
        return JSON.stringify(objOrArray.map((o) => sanitizeImpl(o)));
    } else {
        return sanitizeImpl(objOrArray);
    }
}

function sanitizeImpl(obj: any): string {
    obj = Object.assign({}, obj);
    delete obj.domains; // very long and not really useful
    // Shorten all tokens since we don't usually need the exact values and there's security concerns if they leaked.
    shortenIfExists(obj, "token");
    shortenIfExists(obj, "refresh_token");
    shortenIfExists(obj, "access_token");
    shortenIfExists(obj, "code");
    shortenIfExists(obj, "id_token");
    return JSON.stringify(obj);
}

/**
 * Shortens the given string property on an object if it exists, otherwise does nothing.
 * @param obj The object possibly containing the property
 * @param property The name of the property to shorten - if it exists
 */
function shortenIfExists(obj: any, property: string): void {
    if (obj[property]) {
        obj[property] = shorten(obj[property]);
    }
}

/**
 * Shortens a given string. If it's longer than 6 characters it returns the first 3 characters
 * followed by a ... followed by the last 3 characters. Returns the original string if 6 characters
 * or less.
 * @param str The string to shorten
 * @returns Shortened string in the form 'xxx...xxx'
 */
export function shorten(str?: string): string | undefined {
    // Don't shorten if adding the ... wouldn't make the string shorter.
    if (!str || str.length < 10) {
        return str;
    }
    return `${str.substr(0, 3)}...${str.slice(-3)}`;
}
