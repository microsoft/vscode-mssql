/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as os from 'os';
import { ILogger } from './interfaces';
import { Logger as AzureLogger } from '@microsoft/ads-adal-library';
import * as Utils from './utils';

export enum LogLevel {
	'Pii',
	'Off',
	'Critical',
	'Error',
	'Warning',
	'Information',
	'Verbose',
	'All',
}

/*
* Logger class handles logging messages using the Util functions.
*/
export class Logger implements ILogger, AzureLogger {
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
	 * @param vals Any other values to add on to the end of the log message
	 */
	public pii(msg: any, ...vals: any[]){
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

	private write(logLevel: LogLevel, msg: any, ...vals: any[]) {
		if (this.shouldLog(logLevel) || logLevel === LogLevel.Pii) {
			const fullMessage = `[${LogLevel[logLevel]}]: ${msg} - ${vals.map(v => JSON.stringify(v)).join(' - ')}`;
			this.appendLine(fullMessage);
		}
	}

	public logDebug(message: string): void {
		Utils.logDebug(message);
	}

	public log(msg: any, ...vals: any[]) {
		this.write(LogLevel.All, msg, vals);
	}

	public error(msg: any, ...vals: any[]) {
		this.write(LogLevel.Error, msg, vals);
	}

	public info(msg: any, ...vals: any[]) {
		this.write(LogLevel.Information, msg, vals);
	}

	public verbose(msg: any, ...vals: any[]) {
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