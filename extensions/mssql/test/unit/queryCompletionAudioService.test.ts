/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as chai from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { logger } from "../../src/models/logger";
import {
    maximumCustomAudioFileSize,
    QueryCompletionAudioService,
    QueryCompletionAudioServiceDependencies,
} from "../../src/services/queryCompletionAudioService";
import * as stubs from "./stubs";

const { expect } = chai;

suite("QueryCompletionAudioService", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let readAudioFileStub: sinon.SinonStub;
    let statAudioFileStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
        readAudioFileStub = sandbox.stub();
        statAudioFileStub = sandbox.stub().resolves({
            isFile: () => true,
            size: Buffer.byteLength("mp3 data"),
        });
    });

    teardown(() => {
        sandbox.restore();
    });

    function setConfiguration(enabled: boolean, audioFile = ""): void {
        getConfigurationStub.returns(
            stubs.createWorkspaceConfiguration({
                [Constants.configQueryCompletionSoundEnabled]: enabled,
                [Constants.configQueryCompletionSoundFile]: audioFile,
            }),
        );
    }

    function createService(): QueryCompletionAudioService {
        const dependencies: QueryCompletionAudioServiceDependencies = {
            readAudioFile: readAudioFileStub,
            statAudioFile: statAudioFileStub,
            homeDirectory: () => "/home/test-user",
            logger,
        };
        return new QueryCompletionAudioService(dependencies);
    }

    test("returns no sources when the setting is disabled", async () => {
        setConfiguration(false, "/sounds/complete.mp3");

        const sources = await createService().getAudioSources();

        expect(sources).to.be.undefined;
        expect(readAudioFileStub).not.to.have.been.called;
    });

    test("returns a custom MP3 as a data URL", async () => {
        setConfiguration(true, "/sounds/complete.mp3");
        readAudioFileStub.resolves(Buffer.from("mp3 data"));

        const sources = await createService().getAudioSources();

        expect(readAudioFileStub).to.have.been.calledWith("/sounds/complete.mp3");
        expect(sources.audioSource).to.equal(
            `data:audio/mpeg;base64,${Buffer.from("mp3 data").toString("base64")}`,
        );
        expect(sources.fallbackAudioSource).to.match(/^data:audio\/wav;base64,/);
    });

    test("expands the home directory in a configured path", async () => {
        setConfiguration(true, "~/sounds/complete.mp3");
        readAudioFileStub.resolves(Buffer.from("mp3 data"));

        await createService().getAudioSources();

        expect(readAudioFileStub).to.have.been.calledWith("/home/test-user/sounds/complete.mp3");
    });

    test("uses the default sound when no custom file is configured", async () => {
        setConfiguration(true);

        const sources = await createService().getAudioSources();
        const wav = Buffer.from(sources.audioSource.split(",")[1], "base64");

        expect(sources.audioSource).to.equal(sources.fallbackAudioSource);
        expect(sources.audioSource).to.match(/^data:audio\/wav;base64,/);
        expect(wav.toString("ascii", 0, 4)).to.equal("RIFF");
        expect(wav.toString("ascii", 8, 12)).to.equal("WAVE");
        expect(wav.readUInt32LE(40)).to.equal(wav.byteLength - 44);
    });

    test("uses the default sound for an unsupported file type", async () => {
        setConfiguration(true, "/sounds/complete.wav");

        const sources = await createService().getAudioSources();

        expect(readAudioFileStub).not.to.have.been.called;
        expect(sources.audioSource).to.equal(sources.fallbackAudioSource);
    });

    test("uses the default sound when the custom file cannot be read", async () => {
        setConfiguration(true, "/sounds/missing.mp3");
        statAudioFileStub.rejects(Object.assign(new Error("File not found"), { code: "ENOENT" }));

        const sources = await createService().getAudioSources();

        expect(sources.audioSource).to.equal(sources.fallbackAudioSource);
    });

    test("accepts a custom file at the 200 KiB limit", async () => {
        setConfiguration(true, "/sounds/complete.mp3");
        statAudioFileStub.resolves({
            isFile: () => true,
            size: maximumCustomAudioFileSize,
        });
        readAudioFileStub.resolves(Buffer.alloc(maximumCustomAudioFileSize));

        const sources = await createService().getAudioSources();

        expect(sources.audioSource).to.match(/^data:audio\/mpeg;base64,/);
    });

    test("uses the default sound when the custom file exceeds 200 KiB", async () => {
        setConfiguration(true, "/sounds/complete.mp3");
        statAudioFileStub.resolves({
            isFile: () => true,
            size: maximumCustomAudioFileSize + 1,
        });

        const sources = await createService().getAudioSources();

        expect(readAudioFileStub).not.to.have.been.called;
        expect(sources.audioSource).to.equal(sources.fallbackAudioSource);
    });

    test("uses the default sound when the file grows beyond 200 KiB while being read", async () => {
        setConfiguration(true, "/sounds/complete.mp3");
        statAudioFileStub.resolves({
            isFile: () => true,
            size: maximumCustomAudioFileSize,
        });
        readAudioFileStub.resolves(Buffer.alloc(maximumCustomAudioFileSize + 1));

        const sources = await createService().getAudioSources();

        expect(sources.audioSource).to.equal(sources.fallbackAudioSource);
    });
});
