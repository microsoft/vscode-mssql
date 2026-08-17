/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { readFile, stat } from "fs/promises";
import { homedir } from "os";
import * as path from "path";
import * as vscode from "vscode";
import * as Constants from "../constants/constants";
import { logger } from "../models/logger";
import { ILogger } from "../sharedInterfaces/logger";
import { PlayQueryCompletionSoundParams } from "../sharedInterfaces/queryResult";

export const maximumCustomAudioFileSize = 200 * 1024;

export interface QueryCompletionAudioServiceDependencies {
    readAudioFile: typeof readFile;
    statAudioFile: (file: string) => Promise<{ isFile(): boolean; size: number }>;
    homeDirectory: () => string;
    logger: ILogger;
}

const defaultDependencies: QueryCompletionAudioServiceDependencies = {
    readAudioFile: readFile,
    statAudioFile: stat,
    homeDirectory: homedir,
    logger: logger.withPrefix("QueryCompletionAudioService"),
};

function createDefaultChimeDataUrl(): string {
    const sampleRate = 22_050;
    const durationSeconds = 0.4;
    const sampleCount = Math.floor(sampleRate * durationSeconds);
    const bytesPerSample = 2;
    const wavHeaderSize = 44;
    const dataSize = sampleCount * bytesPerSample;
    const wav = Buffer.alloc(wavHeaderSize + dataSize);

    wav.write("RIFF", 0);
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVE", 8);
    wav.write("fmt ", 12);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24);
    wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
    wav.writeUInt16LE(bytesPerSample, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(dataSize, 40);

    for (let index = 0; index < sampleCount; index++) {
        const time = index / sampleRate;
        const frequency = time < durationSeconds / 2 ? 659.25 : 880;
        const attack = Math.min(1, time / 0.02);
        const release = Math.min(1, (durationSeconds - time) / 0.08);
        const envelope = attack * release;
        const sample = Math.sin(2 * Math.PI * frequency * time) * envelope * 0.2;
        wav.writeInt16LE(Math.round(sample * 32_767), wavHeaderSize + index * bytesPerSample);
    }

    return `data:audio/wav;base64,${wav.toString("base64")}`;
}

const defaultChimeDataUrl = createDefaultChimeDataUrl();

export class QueryCompletionAudioService {
    constructor(
        private readonly _dependencies: QueryCompletionAudioServiceDependencies = defaultDependencies,
    ) {}

    public async getAudioSources(): Promise<PlayQueryCompletionSoundParams | undefined> {
        const configuration = vscode.workspace.getConfiguration(
            Constants.extensionConfigSectionName,
        );
        if (!configuration.get<boolean>(Constants.configQueryCompletionSoundEnabled, false)) {
            return undefined;
        }

        const configuredFile = configuration
            .get<string>(Constants.configQueryCompletionSoundFile, "")
            .trim();
        const customAudioSource = await this.getCustomAudioSource(configuredFile);

        return {
            audioSource: customAudioSource ?? defaultChimeDataUrl,
            fallbackAudioSource: defaultChimeDataUrl,
        };
    }

    private async getCustomAudioSource(configuredFile: string): Promise<string | undefined> {
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
            const audioFileStats = await this._dependencies.statAudioFile(audioFile);
            if (!audioFileStats.isFile()) {
                this._dependencies.logger.warn(
                    `The configured query completion sound "${audioFile}" is not a file. Falling back to the default sound.`,
                );
                return undefined;
            }
            if (audioFileStats.size > maximumCustomAudioFileSize) {
                this._dependencies.logger.warn(
                    `The configured query completion sound "${audioFile}" is larger than 200 KiB. Falling back to the default sound.`,
                );
                return undefined;
            }

            const audio = await this._dependencies.readAudioFile(audioFile);
            if (audio.byteLength > maximumCustomAudioFileSize) {
                this._dependencies.logger.warn(
                    `The configured query completion sound "${audioFile}" grew beyond 200 KiB while it was being read. Falling back to the default sound.`,
                );
                return undefined;
            }
            return `data:audio/mpeg;base64,${audio.toString("base64")}`;
        } catch (error) {
            this._dependencies.logger.warn(
                `The configured query completion sound "${audioFile}" could not be read. Falling back to the default sound.`,
                error,
            );
            return undefined;
        }
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
}
