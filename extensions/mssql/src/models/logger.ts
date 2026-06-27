/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import * as Utils from "./utils";
import { ILogger } from "../sharedInterfaces/logger";

export const loggerOutputChannelName = Constants.outputChannelName;

type LogMethod = "trace" | "debug" | "info" | "warn" | "error";
type ChannelFactory = () => vscode.LogOutputChannel;

interface LoggerChannelState {
    ownsChannel: boolean;
    cachedChannel?: vscode.LogOutputChannel;
    createChannel: ChannelFactory;
}

let defaultChannel: vscode.LogOutputChannel | undefined;
const defaultChannelState: LoggerChannelState = {
    createChannel: () => {
        defaultChannel ??= vscode.window.createOutputChannel(loggerOutputChannelName, {
            log: true,
        });
        return defaultChannel;
    },
    ownsChannel: false,
};

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
export class Logger implements ILogger {
    private constructor(
        private readonly _channelState: LoggerChannelState,
        private readonly _prefix?: string,
    ) {}

    /**
     * Creates a logger backed by the shared MSSQL output channel.
     */
    public static global(prefix?: string): Logger {
        return new Logger(defaultChannelState, prefix);
    }

    /**
     * Creates a logger backed by an existing log channel.
     */
    public static forChannel(channel: vscode.LogOutputChannel, prefix?: string): Logger {
        return new Logger(
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
    public static forChannelName(channelName: string, prefix?: string): Logger {
        return new Logger(
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
    public withPrefix(prefix: string): Logger {
        return new Logger(this._channelState, prefix);
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
 * Root shared MSSQL logger instance used to create prefixed loggers.
 */
const rootLogger: ILogger = Logger.global();

/**
 * Gets the shared MSSQL logger, optionally with a prefix.
 */
export function getLogger(prefix?: string): ILogger {
    return prefix ? rootLogger.withPrefix(prefix) : rootLogger;
}

/**
 * Shared MSSQL logger instance for callers that do not need a custom channel or prefix.
 */
export const logger: ILogger = getLogger();

export default logger;

/**
 * Exported for unit tests to isolate the cached default channel.
 */
export function resetLoggerDefaultChannelForTest(): void {
    // Keep the channel alive to avoid race conditions with late async log callbacks
    // that can run after test teardown and throw "Channel has been closed".
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
