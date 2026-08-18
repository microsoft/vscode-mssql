/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn, SpawnOptions } from "child_process";
import { stat } from "fs/promises";
import { arch, homedir, release, type, version } from "os";
import * as path from "path";
import * as vscode from "vscode";
import { sendActionEvent } from "extension-toolkit/vscode";
import * as Constants from "../constants/constants";
import { logger } from "../models/logger";
import { ILogger } from "../sharedInterfaces/logger";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";

const maximumPlaybackMilliseconds = 5_000;
const bundledCompletionSoundFile = "query-complete.mp3";

type PlaybackFailureStage = "systemSound" | "bundledSound";

interface AudioCommand {
    command: string;
    args: string[];
    options?: SpawnOptions;
}

export interface AudioProcess {
    readonly killed: boolean;
    kill(): boolean;
    once(event: "spawn", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    once(
        event: "close",
        listener: (code: number | null, signal: NodeJS.Signals | null) => void,
    ): this;
}

export type SpawnAudioProcess = (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
) => AudioProcess;

export interface QueryCompletionSoundServiceDependencies {
    platform: NodeJS.Platform;
    architecture: string;
    spawnProcess: SpawnAudioProcess;
    statFile: (file: string) => Promise<{ isFile(): boolean }>;
    homeDirectory: () => string;
    osType: () => string;
    osRelease: () => string;
    osVersion: () => string;
    sendPlaybackFailureTelemetry: (properties: Record<string, string>) => void;
    logger: ILogger;
}

const defaultDependencies: QueryCompletionSoundServiceDependencies = {
    platform: process.platform,
    architecture: arch(),
    spawnProcess: spawn,
    statFile: stat,
    homeDirectory: homedir,
    osType: type,
    osRelease: release,
    osVersion: version,
    sendPlaybackFailureTelemetry: (properties) =>
        sendActionEvent(
            TelemetryViews.QueryEditor,
            TelemetryActions.QueryCompletionSoundPlaybackFailed,
            properties,
        ),
    logger: logger.withPrefix("QueryCompletionSoundService"),
};

export class QueryCompletionSoundService {
    constructor(
        private readonly _extensionPath: string,
        private readonly _dependencies: QueryCompletionSoundServiceDependencies = defaultDependencies,
    ) {}

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
            const customSoundPlayed = await this.runCommands(
                this.getCustomAudioCommands(customAudioFile),
            );
            if (customSoundPlayed) {
                return;
            }

            this._dependencies.logger.warn(
                `Unable to play the configured query completion sound "${customAudioFile}". Falling back to the default sound.`,
            );
        }

        const defaultSoundPlayed = await this.runCommands(this.getDefaultAudioCommands());
        if (defaultSoundPlayed) {
            return;
        }

        this._dependencies.logger.warn(
            "Unable to play the default system query completion sound. Falling back to the bundled sound.",
        );
        this.emitPlaybackFailureTelemetry("systemSound");

        const bundledAudioFile = path.join(
            this._extensionPath,
            "media",
            bundledCompletionSoundFile,
        );
        const bundledSoundPlayed = await this.runCommands(
            this.getCustomAudioCommands(bundledAudioFile),
        );
        if (!bundledSoundPlayed) {
            this._dependencies.logger.warn(
                "Unable to play the bundled query completion sound because no supported audio player could be used.",
            );
            this.emitPlaybackFailureTelemetry("bundledSound");
        }
    }

    private emitPlaybackFailureTelemetry(failureStage: PlaybackFailureStage): void {
        this._dependencies.sendPlaybackFailureTelemetry({
            failureStage,
            platform: this._dependencies.platform,
            architecture: this._dependencies.architecture,
            osType: this._dependencies.osType(),
            osRelease: this._dependencies.osRelease(),
            osVersion: this._dependencies.osVersion(),
        });
    }

    private async getValidCustomAudioFile(configuredFile: string): Promise<string | undefined> {
        if (!configuredFile) {
            return undefined;
        }

        const audioFile = this.expandHomeDirectory(configuredFile);
        if (path.extname(audioFile).toLowerCase() !== ".mp3") {
            this._dependencies.logger.warn(
                `The configured query completion sound "${audioFile}" is not an MP3 file. Falling back to the default sound.`,
            );
            return undefined;
        }

        try {
            const fileStats = await this._dependencies.statFile(audioFile);
            if (fileStats.isFile()) {
                return audioFile;
            }

            this._dependencies.logger.warn(
                `The configured query completion sound "${audioFile}" is not a file. Falling back to the default sound.`,
            );
        } catch (error) {
            this._dependencies.logger.warn(
                `The configured query completion sound "${audioFile}" could not be accessed. Falling back to the default sound.`,
                error,
            );
        }

        return undefined;
    }

    private expandHomeDirectory(configuredFile: string): string {
        if (configuredFile === "~") {
            return this._dependencies.homeDirectory();
        }
        if (configuredFile.startsWith("~/") || configuredFile.startsWith(`~${path.sep}`)) {
            return path.join(this._dependencies.homeDirectory(), configuredFile.slice(2));
        }
        return configuredFile;
    }

    private getCustomAudioCommands(audioFile: string): AudioCommand[] {
        switch (this._dependencies.platform) {
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
                                "$player = New-Object -ComObject WMPlayer.OCX",
                                "$player.URL = $env:MSSQL_QUERY_COMPLETION_SOUND",
                                "$player.controls.play()",
                                "Start-Sleep -Milliseconds 100",
                                "$deadline = (Get-Date).AddSeconds(5)",
                                "while ((Get-Date) -lt $deadline -and $player.playState -ne 1) { Start-Sleep -Milliseconds 100 }",
                                "$player.controls.stop()",
                                "$player.close()",
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
                    {
                        command: "ffplay",
                        args: ["-nodisp", "-autoexit", "-loglevel", "quiet", audioFile],
                    },
                    { command: "mpg123", args: ["--quiet", audioFile] },
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

    private getDefaultAudioCommands(): AudioCommand[] {
        switch (this._dependencies.platform) {
            case Constants.Platform.Mac:
                return [
                    {
                        command: "/usr/bin/afplay",
                        args: ["/System/Library/Sounds/Glass.aiff"],
                    },
                ];
            case Constants.Platform.Windows:
                return [
                    {
                        command: "powershell.exe",
                        args: [
                            "-NoLogo",
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            "[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 1000",
                        ],
                    },
                ];
            case Constants.Platform.Linux:
                return [
                    { command: "canberra-gtk-play", args: ["--id=complete"] },
                    {
                        command: "paplay",
                        args: ["/usr/share/sounds/freedesktop/stereo/complete.oga"],
                    },
                    {
                        command: "aplay",
                        args: ["/usr/share/sounds/alsa/Front_Center.wav"],
                    },
                ];
            default:
                return [];
        }
    }

    private async runCommands(commands: AudioCommand[]): Promise<boolean> {
        for (const command of commands) {
            if (await this.runCommand(command)) {
                return true;
            }
        }
        return false;
    }

    private runCommand(audioCommand: AudioCommand): Promise<boolean> {
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

            let audioProcess: AudioProcess;
            try {
                audioProcess = this._dependencies.spawnProcess(
                    audioCommand.command,
                    audioCommand.args,
                    {
                        windowsHide: true,
                        stdio: "ignore",
                        ...audioCommand.options,
                    },
                );
            } catch (error) {
                this._dependencies.logger.debug(
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
                this._dependencies.logger.debug(
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
