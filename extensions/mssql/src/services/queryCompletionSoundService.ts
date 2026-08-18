/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as childProcess from "child_process";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as telemetry from "extension-toolkit/vscode";
import * as Constants from "../constants/constants";
import { logger } from "../models/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

const maximumPlaybackMilliseconds = 5_000;
const maximumCustomAudioFileBytes = 400 * 1024;
const bundledCompletionSoundFile = "query-complete.wav";

interface AudioCommand {
    command: string;
    args: string[];
    options?: childProcess.SpawnOptions;
}

export class QueryCompletionSoundService {
    private readonly _logger = logger.withPrefix("QueryCompletionSoundService");

    constructor(private readonly _extensionPath: string) {}

    public async play(): Promise<void> {
        const configuration = vscode.workspace.getConfiguration(
            Constants.extensionConfigSectionName,
        );
        if (!configuration.get<boolean>(Constants.configQueryCompletionSoundEnabled, false)) {
            return;
        }

        const configuredFile = configuration
            .get<string>(Constants.configQueryCompletionSoundFile, "")
            .trim();
        const customAudioFile = await this.getValidCustomAudioFile(configuredFile);

        if (customAudioFile) {
            const customSoundPlayed = await this.tryPlayAudio(
                this.getCustomAudioCommands(customAudioFile),
            );
            if (customSoundPlayed) {
                return;
            }

            this._logger.warn(
                `Unable to play the configured query completion sound "${customAudioFile}". Falling back to the default sound.`,
            );
        }

        const bundledAudioFile = path.join(
            this._extensionPath,
            "media",
            bundledCompletionSoundFile,
        );
        const bundledSoundPlayed = await this.tryPlayAudio(
            this.getCustomAudioCommands(bundledAudioFile),
        );
        if (!bundledSoundPlayed) {
            this._logger.warn(
                "Unable to play the bundled default query completion sound because no supported audio player could be used.",
            );
            this.emitPlaybackFailureTelemetry();
        }
    }

    private emitPlaybackFailureTelemetry(): void {
        telemetry.sendActionEvent(
            TelemetryViews.QueryEditor,
            TelemetryActions.QueryCompletionSoundPlaybackFailed,
            {
                failureStage: "bundledDefaultSound",
                platform: os.platform(),
                architecture: os.arch(),
                osType: os.type(),
                osRelease: os.release(),
                osVersion: os.version(),
            },
        );
    }

    private async getValidCustomAudioFile(configuredFile: string): Promise<string | undefined> {
        if (!configuredFile) {
            return undefined;
        }

        const audioFile = this.expandHomeDirectory(configuredFile);

        if (path.extname(audioFile).toLowerCase() !== ".wav") {
            this._logger.warn(
                `The configured query completion sound "${audioFile}" is not a WAV file. Falling back to the default sound.`,
            );

            return undefined;
        }

        try {
            const fileStats = await fsPromises.stat(audioFile);

            if (!fileStats.isFile()) {
                this._logger.warn(
                    `The configured query completion sound "${audioFile}" is not a file. Falling back to the default sound.`,
                );
                return undefined;
            }

            if (fileStats.size > maximumCustomAudioFileBytes) {
                this._logger.error(
                    `The configured query completion sound "${audioFile}" is larger than 400 KB and will not be played. Falling back to the default sound.`,
                );
                return undefined;
            }

            return audioFile;
        } catch (error) {
            this._logger.warn(
                `The configured query completion sound "${audioFile}" could not be accessed. Falling back to the default sound.`,
                error,
            );
        }

        return undefined;
    }

    private expandHomeDirectory(configuredFile: string): string {
        if (configuredFile === "~") {
            return os.homedir();
        }
        if (configuredFile.startsWith("~/") || configuredFile.startsWith(`~${path.sep}`)) {
            return path.join(os.homedir(), configuredFile.slice(2));
        }
        return configuredFile;
    }

    private getCustomAudioCommands(audioFile: string): AudioCommand[] {
        switch (os.platform()) {
            case Constants.Platform.Mac:
                return [{ command: "/usr/bin/afplay", args: [audioFile] }];
            case Constants.Platform.Windows:
                return [
                    {
                        command: "powershell.exe",
                        args: [
                            "-NoLogo",
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            [
                                "$ErrorActionPreference = 'Stop'",
                                "$player = New-Object System.Media.SoundPlayer",
                                "try { $player.SoundLocation = $env:MSSQL_QUERY_COMPLETION_SOUND; $player.Load(); $player.PlaySync() } finally { $player.Dispose() }",
                            ].join("; "),
                        ],
                        options: {
                            env: {
                                ...process.env,
                                MSSQL_QUERY_COMPLETION_SOUND: audioFile,
                            },
                        },
                    },
                ];
            case Constants.Platform.Linux:
                return [
                    { command: "pw-play", args: [audioFile] },
                    { command: "paplay", args: [audioFile] },
                    { command: "aplay", args: ["--quiet", audioFile] },
                    {
                        command: "ffplay",
                        args: ["-nodisp", "-autoexit", "-loglevel", "quiet", audioFile],
                    },
                    {
                        command: "mpv",
                        args: ["--no-video", "--really-quiet", audioFile],
                    },
                    {
                        command: "cvlc",
                        args: ["--play-and-exit", "--intf", "dummy", audioFile],
                    },
                ];
            default:
                return [];
        }
    }

    /**
     * Attempts to run the provided audio commands in order until one of them successfully plays the audio.
     * @returns whether the audio was successfully played by any of the commands.
     */
    private async tryPlayAudio(commands: AudioCommand[]): Promise<boolean> {
        for (const command of commands) {
            if (await this.tryPlayAudioCommand(command)) {
                return true;
            }
        }

        return false;
    }

    private tryPlayAudioCommand(audioCommand: AudioCommand): Promise<boolean> {
        return new Promise((resolve) => {
            let hasStarted = false;
            let hasSettled = false;
            let playbackTimer: NodeJS.Timeout;

            const finish = (didPlay: boolean): void => {
                if (hasSettled) {
                    return;
                }
                hasSettled = true;
                clearTimeout(playbackTimer);
                resolve(didPlay);
            };

            let audioProcess: childProcess.ChildProcess;
            try {
                audioProcess = childProcess.spawn(audioCommand.command, audioCommand.args, {
                    windowsHide: true,
                    stdio: "ignore",
                    ...audioCommand.options,
                });
            } catch (error) {
                this._logger.debug(
                    `Unable to start audio player "${audioCommand.command}".`,
                    error,
                );
                resolve(false);
                return;
            }

            playbackTimer = setTimeout(() => {
                if (!audioProcess.killed) {
                    audioProcess.kill();
                }
                finish(hasStarted);
            }, maximumPlaybackMilliseconds);

            audioProcess.once("spawn", () => {
                hasStarted = true;
            });
            audioProcess.once("error", (error) => {
                this._logger.debug(
                    `Audio player "${audioCommand.command}" failed to start.`,
                    error,
                );
                finish(false);
            });
            audioProcess.once("close", (code, signal) => {
                finish(hasStarted && (code === 0 || signal !== null));
            });
        });
    }
}
