/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from "promisify-child-process";
import * as vscode from "vscode";
import { l10n } from "vscode";

export interface ShellCommandOptions {
    workingDirectory?: string;
    additionalEnvironmentVariables?: NodeJS.ProcessEnv;
    commandTitle?: string;
    argument?: string;
}

export class ShellExecutionHelper {
    constructor(protected _outputChannel: vscode.OutputChannel) {}

    /**
     * Spawns a process with the given executable and arguments, redirecting output to the output channel.
     * Uses shell: false to prevent OS command injection via unsanitized arguments.
     */
    public async runStreamedCommand(
        executable: string,
        args: string[],
        options?: ShellCommandOptions,
        sensitiveData: string[] = [],
        timeout: number = 5 * 60 * 1000,
    ): Promise<string> {
        const stdoutData: string[] = [];

        const fullCommand = [executable, ...args].join(" ");
        let cmdOutputMessage = fullCommand;
        sensitiveData.forEach((element) => {
            cmdOutputMessage = cmdOutputMessage.replace(element, "***");
        });

        this._outputChannel.appendLine(`    > ${cmdOutputMessage}`);

        const spawnOptions = {
            cwd: options && options.workingDirectory,
            env: Object.assign({}, process.env, options && options.additionalEnvironmentVariables),
            encoding: "utf8",
            maxBuffer: 10 * 1024 * 1024, // 10 Mb of output can be captured.
            shell: false,
            detached: false,
            windowsHide: true,
            timeout: timeout,
        };

        try {
            const child = cp.spawn(executable, args, spawnOptions);
            this._outputChannel.show();

            // Add listeners to print stdout and stderr and exit code
            void child.on("exit", (code: number | null, signal: string | null) => {
                if (code !== null) {
                    this._outputChannel.appendLine(
                        l10n.t("    >>> {0}    … exited with code: {1}", cmdOutputMessage, code),
                    );
                } else {
                    this._outputChannel.appendLine(
                        l10n.t("    >>> {0}   … exited with signal: {1}", cmdOutputMessage, signal),
                    );
                }
            });

            child.stdout!.on("data", (data: string | Buffer) => {
                stdoutData.push(data.toString());
                ShellExecutionHelper.outputDataChunk(
                    this._outputChannel,
                    data,
                    l10n.t("    stdout: "),
                );
            });

            child.stderr!.on("data", (data: string | Buffer) => {
                ShellExecutionHelper.outputDataChunk(
                    this._outputChannel,
                    data,
                    l10n.t("    stderr: "),
                );
            });

            await child;

            return stdoutData.join("");
        } catch (err) {
            // removing sensitive data from the exception
            if (err && typeof err === "object") {
                sensitiveData.forEach((element) => {
                    if ("cmd" in err && typeof err.cmd === "string") {
                        err.cmd = err.cmd.replace(element, "***");
                    }
                    if ("message" in err && typeof err.message === "string") {
                        err.message = err.message.replace(element, "***");
                    }
                });
            }

            throw err;
        }
    }

    private static outputDataChunk(
        outputChannel: vscode.OutputChannel,
        data: string | Buffer,
        header: string,
    ): void {
        data.toString()
            .split(/\r?\n/)
            .forEach((line) => {
                if (outputChannel) {
                    outputChannel.appendLine(header + line);
                }
            });
    }
}
