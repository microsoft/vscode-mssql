/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import { ILogger } from './interfaces';
import * as Utils from './utils';

export enum LogLevel {
	'Pii',
	'Off',
	'Critical',
	'Error',
	'Warning',
	'Information',
	'Verbose',
	'All'
}

/*
* Logger class handles logging messages using the Util functions.
*/
export class Logger implements ILogger {
	private _writer: (message: string) => void;
	private _piiLogging: boolean = false;
	private _prefix: string;
	private _logLevel: LogLevel;

	private _indentLevel: number = 0;
	private _indentSize: number = 4;
	private _atLineStart: boolean = false;

	constructor(writer: (message: string) => void, logLevel: LogLevel, piiLogging: boolean, prefix?: string) {
		this._writer = writer;
		this._logLevel = logLevel;
		this._piiLogging = piiLogging;
		this._prefix = prefix;
	}

	/**
	 * Logs a message containing PII (when enabled). Provides the ability to sanitize or shorten values to hide information or reduce the amount logged.
	 * @param msg The initial message to log
	 * @param objsToSanitize Set of objects we want to sanitize
	 * @param stringsToShorten Set of strings to shorten
	 * @param vals Any other values to add on to the end of the log message
	 */
	public piiSantized(msg: any, objsToSanitize: { name: string, objOrArray: any | any[] }[],
		stringsToShorten: { name: string, value: string }[], ...vals: any[]): void {
		if (this.piiLogging) {
			msg = [
				msg,
				...objsToSanitize?.map(obj => `${obj.name}=${sanitize(obj.objOrArray)}`),
				...stringsToShorten.map(str => `${str.name}=${shorten(str.value)}`)
			].join(' ');
			this.write(LogLevel.Pii, msg, vals);
		}
	}

	/**
	 * Logs a message containing PII (when enabled).
	 * @param msg The initial message to log
	 * @param vals Any other values to add on to the end of the log message
	 */
	public pii(msg: any, ...vals: any[]): void {
		if (this.piiLogging) {
			this.write(LogLevel.Pii, msg, vals);
		}
	}

	public set piiLogging(val: boolean) {
		this._piiLogging = val;
	}

	public get piiLogging(): boolean {
		return this._piiLogging;
	}

	public shouldLog(logLevel: LogLevel): Boolean {
		return logLevel <= this._logLevel;
	}

	private write(logLevel: LogLevel, msg: any, ...vals: any[]): void {
		if (this.shouldLog(logLevel) || logLevel === LogLevel.Pii) {
			const fullMessage = `[${LogLevel[logLevel]}]: ${msg} - ${vals.map(v => JSON.stringify(v)).join(' - ')}`;
			this.appendLine(fullMessage);
		}
	}

	public logDebug(message: string): void {
		Utils.logDebug(message);
	}

	public log(msg: any, ...vals: any[]): void {
		this.write(LogLevel.All, msg, vals);
	}

	public error(msg: any, ...vals: any[]): void {
		this.write(LogLevel.Error, msg, vals);
	}

	public info(msg: any, ...vals: any[]): void {
		this.write(LogLevel.Information, msg, vals);
	}

	public verbose(msg: any, ...vals: any[]): void {
		this.write(LogLevel.Verbose, msg, vals);
	}

	private appendCore(message: string): void {
		if (this._atLineStart) {
			if (this._indentLevel > 0) {
				const indent = ' '.repeat(this._indentLevel * this._indentSize);
				this._writer(indent);
			}

			if (this._prefix) {
				this._writer(`[${this._prefix}] `);
			}

			this._atLineStart = false;
		}

		this._writer(message);
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
		message = message || '';
		this.appendCore(message);
	}

	public appendLine(message?: string): void {
		message = message || '';
		this.appendCore(message + os.EOL);
		this._atLineStart = true;
	}
}

/**
 * Sanitizes a given object for logging to the output window, removing/shortening any PII or unneeded values
 * @param objOrArray The object to sanitize for output logging
 * @returns The stringified version of the sanitized object
 */
function sanitize(objOrArray: any): string {
	if (Array.isArray(objOrArray)) {
		return JSON.stringify(objOrArray.map(o => sanitizeImpl(o)));
	} else {
		return sanitizeImpl(objOrArray);
	}
}

function sanitizeImpl(obj: any): string {
	obj = Object.assign({}, obj);
	delete obj.domains; // very long and not really useful
	// shorten all tokens since we don't usually need the exact values and there's security concerns if they leaked
	shortenIfExists(obj, 'token');
	shortenIfExists(obj, 'refresh_token');
	shortenIfExists(obj, 'access_token');
	shortenIfExists(obj, 'code');
	shortenIfExists(obj, 'id_token');
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
