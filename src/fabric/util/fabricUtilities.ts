import * as vscode from 'vscode';

import { TaskHelperWithTimeout } from './TaskHelperWithTimeout';
import { TelemetryService } from './telemetry/TelemetryService';
import { ILogger } from './logger/Logger';

/**
 * These are some methods that are useful from both core fabric and satellite extensions
 */
export function sleep(msecs: number): Promise<any> {
    return new Promise((resolve) => setTimeout(resolve, msecs));
}

/**
 * @returns a class that determines the winner of a race condition between a promise and a timeout
 */
export async function doTaskWithTimeout(
    task: Promise<any>,
    msecs: number,
    timeoutReason: string,
): Promise<any> {
    const helper = new TaskHelperWithTimeout();
    let result = await helper.wrap(task, msecs, timeoutReason);
    return result;
}

/**
 * Execute a cmd in a terminal window.
 * @param cmd the cmd to execute in the terminal window.
 * @param timeout  A timeout in msecs.
 * @returns
 */
export async function doExecuteTerminalTask(cmd: string, timeout: number): Promise<string> {
    let terminalTask = new Promise<string>((resolve, reject) => {
        const terminal = vscode.window.createTerminal('Open Terminal');
        let disp = vscode.window.onDidCloseTerminal((closedTerminal) => {
            if (closedTerminal === terminal) {
                disp.dispose();
                if (terminal.exitStatus !== undefined) {
                    resolve(
                        `Terminal Exited Code= ${terminal.exitStatus.code} Reason= ${terminal.exitStatus.reason} `,
                    );
                }
                else {
                    reject('Terminal status unknown');
                }
            }
        });
        terminal.show();
        //        terminal.sendText('dotnet restore; exit');
        terminal.sendText(cmd);
        terminal.sendText('exit');
    });
    const myTimeoutHelper = new TaskHelperWithTimeout();
    let result = await myTimeoutHelper.wrap(
        terminalTask,
        timeout,
        `Terminal Task ${cmd} TimedOut ${timeout}`,
    );
    return result;
}

//// Parse a json string and log any errors
export function doJSONParse(description: string, jsonstring: string, logger: ILogger, telemetryService: TelemetryService | null): any {
    try {
        return JSON.parse(jsonstring);
    }
    catch (error) {
        logger?.reportExceptionTelemetryAndLog(description, 'json-parse', error, telemetryService);
        throw error;
    }
}
