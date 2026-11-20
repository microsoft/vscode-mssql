/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as childProcess from "child_process";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as path from "path";
import * as vscode from "vscode";
import { sendErrorEvent, getErrorMessage } from "extension-toolkit/vscode";
import * as Constants from "../constants/constants";
import { logger } from "../models/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import { expandTildePath } from "../utils/utils";

/**
 * Playback duration after which audio playback is truncated
 */
const MAXIMUM_PLAYBACK_MILLISECONDS = 5_000;

/**
 * File size limit for custom audio files to avoid performance issues
 */
const MAXIMUM_CUSTOM_COMPLETION_SOUND_FILESIZE_KB = 400;

/**
 * Settings and bundled defaults for each kind of query completion sound
 */
const COMPLETION_SOUNDS = {
    success: {
        customFileSetting: Constants.configQueryCompletionSoundFile,
        defaultFilename: "query-complete.wav",
        logLabel: "query completion sound",
    },
    error: {
        customFileSetting: Constants.configQueryErrorSoundFile,
        defaultFilename: "query-error.wav",
        logLabel: "query error sound",
    },
} as const;

type CompletionSoundType = keyof typeof COMPLETION_SOUNDS;

interface AudioCommand {
    command: string;
    args: string[];
    options?: childProcess.SpawnOptions;
}

/**
 * Plays a sound when a query finishes executing: an error sound if any batch failed, otherwise a completion sound.
 */
export class QueryCompletionSoundService {
    private readonly _logger = logger.withPrefix("QueryCompletionSoundService");

    constructor(private readonly _extensionPath: string) {}

    /**
     * Plays a single sound for a completed query, if enabled.
     * @param hasError whether any batch in the query failed; the error sound takes priority over the completion sound.
     */
    public async play(hasError: boolean = false): Promise<void> {
        const configuration = vscode.workspace.getConfiguration(
            Constants.extensionConfigSectionName,
        );
        if (!configuration.get<boolean>(Constants.configQueryCompletionSoundEnabled, false)) {
            return;
        }

        const soundType: CompletionSoundType = hasError ? "error" : "success";
        const sound = COMPLETION_SOUNDS[soundType];
        const defaultAudioPath = path.join(this._extensionPath, "media", sound.defaultFilename);

        const configuredFile = configuration.get<string>(sound.customFileSetting, "").trim();
        const customCompletionSoundPath = await this.getCustomCompletionSoundPath(
            configuredFile,
            sound.logLabel,
        );

        // 1. Attempt to play custom audio if configured and valid
        if (customCompletionSoundPath) {
            if (await this.tryPlayAudio(customCompletionSoundPath)) {
                return;
            } else {
                this._logger.warn(
                    `Unable to play the custom ${sound.logLabel} "${customCompletionSoundPath}". Using default sound instead.`,
                );
            }
        }

        if (!(await this.tryPlayAudio(defaultAudioPath))) {
            const message = `Unable to play the bundled default ${sound.logLabel} because no supported audio player could be used.`;
            this._logger.warn(message);

            sendErrorEvent(
                TelemetryViews.QueryEditor,
                TelemetryActions.QueryCompletionSoundPlayback,
                {
                    error: new Error(message),
                    // The message is a fixed extension-authored string and contains no user data.
                    includeErrorMessage: true,
                    additionalProps: {
                        platform: os.platform(),
                        architecture: os.arch(),
                        osType: os.type(),
                        osRelease: os.release(),
                        osVersion: os.version(),
                        soundType,
                    },
                },
            );
        }
    }

    private async getCustomCompletionSoundPath(
        configuredFile: string,
        logLabel: string,
    ): Promise<string | undefined> {
        if (!configuredFile) {
            return undefined;
        }

        const audioFile = expandTildePath(configuredFile);

        // only .wav files are supported due to cross-platform compatibility for playing encoded audio
        if (path.extname(audioFile).toLowerCase() !== ".wav") {
            this._logger.warn(
                `The configured ${logLabel} "${audioFile}" is not a WAV file. Using default sound.`,
            );

            return undefined;
        }

        try {
            const fileStats = await fsPromises.stat(audioFile);

            if (!fileStats.isFile()) {
                this._logger.warn(
                    `The configured ${logLabel} "${audioFile}" is not a file. Using default sound instead.`,
                );
                return undefined;
            }

            if (
                fileStats.size >
                MAXIMUM_CUSTOM_COMPLETION_SOUND_FILESIZE_KB * 1024 /* convert to bytes */
            ) {
                this._logger.error(
                    `The configured ${logLabel} "${audioFile}" is larger than ${MAXIMUM_CUSTOM_COMPLETION_SOUND_FILESIZE_KB} KB and will not be played. Using default sound instead.`,
                );
                return undefined;
            }

            return audioFile;
        } catch (error) {
            this._logger.warn(
                `The configured ${logLabel} "${audioFile}" could not be accessed. Using default sound instead.`,
                getErrorMessage(error),
            );
        }

        return undefined;
    }

    private getAudioCommands(audioFile: string): AudioCommand[] {
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
    private async tryPlayAudio(audioFile: string): Promise<boolean> {
        for (const command of this.getAudioCommands(audioFile)) {
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

            // Stop the process at the playback limit, truncating longer audio files.
            playbackTimer = setTimeout(() => {
                if (!audioProcess.killed) {
                    audioProcess.kill();
                }
                finish(hasStarted);
            }, MAXIMUM_PLAYBACK_MILLISECONDS);

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
                // eslint-disable-next-line no-restricted-syntax
                finish(hasStarted && (code === 0 || signal !== null));
            });
        });
    }
}
