/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export enum LoggerMethod {
    Trace = "trace",
    Debug = "debug",
    Info = "info",
    Warn = "warn",
    Error = "error",
    PiiSanitized = "piiSanitized",
    Show = "show",
    Dispose = "dispose",
}

export type LoggerMessageMethod =
    | LoggerMethod.Trace
    | LoggerMethod.Debug
    | LoggerMethod.Info
    | LoggerMethod.Warn
    | LoggerMethod.Error;

export interface ILogger {
    trace(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    piiSanitized(
        msg: unknown,
        objsToSanitize: { name: string; objOrArray: unknown | unknown[] }[],
        stringsToShorten: { name: string; value: string }[],
        ...vals: unknown[]
    ): void;
    show(preserveFocus?: boolean): void;
    withPrefix(prefix: string): ILogger;
    dispose(): void;
}

export type LogEvent =
    | {
          method: LoggerMessageMethod;
          message: string;
          args?: unknown[];
          prefix?: string;
      }
    | {
          method: LoggerMethod.PiiSanitized;
          msg: unknown;
          objsToSanitize: { name: string; objOrArray: unknown | unknown[] }[];
          stringsToShorten: { name: string; value: string }[];
          vals?: unknown[];
          prefix?: string;
      }
    | {
          method: LoggerMethod.Show;
          preserveFocus?: boolean;
          prefix?: string;
      }
    | {
          method: LoggerMethod.Dispose;
          prefix?: string;
      };
