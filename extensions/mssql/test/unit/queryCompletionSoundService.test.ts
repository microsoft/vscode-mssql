/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from "events";
import * as chai from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { logger } from "../../src/models/logger";
import {
    AudioProcess,
    QueryCompletionSoundService,
    QueryCompletionSoundServiceDependencies,
} from "../../src/services/queryCompletionSoundService";
import * as stubs from "./stubs";

const { expect } = chai;

class TestAudioProcess extends EventEmitter implements AudioProcess {
    public killed = false;

    public kill(): boolean {
        this.killed = true;
        return true;
    }
}

suite("QueryCompletionSoundService", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let spawnProcessStub: sinon.SinonStub;
    let statFileStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
        spawnProcessStub = sandbox.stub();
        statFileStub = sandbox.stub().resolves({ isFile: () => true });
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

    function createService(
        platform: NodeJS.Platform = Constants.Platform.Mac,
    ): QueryCompletionSoundService {
        const dependencies: QueryCompletionSoundServiceDependencies = {
            platform,
            spawnProcess: spawnProcessStub,
            statFile: statFileStub,
            homeDirectory: () => "/home/test-user",
            logger,
        };
        return new QueryCompletionSoundService(dependencies);
    }

    function returnSuccessfulProcess(): TestAudioProcess {
        const audioProcess = new TestAudioProcess();
        spawnProcessStub.callsFake(() => {
            setImmediate(() => {
                audioProcess.emit("spawn");
                audioProcess.emit("close", 0, null);
            });
            return audioProcess;
        });
        return audioProcess;
    }

    test("does not start a player when the setting is disabled", async () => {
        setConfiguration(false, "/sounds/complete.mp3");

        await createService().play();

        expect(spawnProcessStub).not.to.have.been.called;
    });

    test("plays a configured MP3 file", async () => {
        setConfiguration(true, "/sounds/complete.mp3");
        returnSuccessfulProcess();

        await createService().play();

        expect(spawnProcessStub).to.have.been.calledWith(
            "/usr/bin/afplay",
            ["/sounds/complete.mp3"],
            sinon.match({
                windowsHide: true,
                stdio: "ignore",
            }),
        );
    });

    test("expands the home directory in a configured path", async () => {
        setConfiguration(true, "~/sounds/complete.mp3");
        returnSuccessfulProcess();

        await createService().play();

        expect(statFileStub).to.have.been.calledWith("/home/test-user/sounds/complete.mp3");
        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/home/test-user/sounds/complete.mp3",
        ]);
    });

    test("expands a forward-slash home directory path on Windows", async () => {
        setConfiguration(true, "~/sounds/complete.mp3");
        returnSuccessfulProcess();

        await createService(Constants.Platform.Windows).play();

        expect(statFileStub).to.have.been.calledWith("/home/test-user/sounds/complete.mp3");
    });

    test("plays the default sound when the configured file type is unsupported", async () => {
        setConfiguration(true, "/sounds/complete.wav");
        returnSuccessfulProcess();

        await createService().play();

        expect(statFileStub).not.to.have.been.called;
        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/System/Library/Sounds/Glass.aiff",
        ]);
    });

    test("plays the default sound when the configured file does not exist", async () => {
        setConfiguration(true, "/sounds/missing.mp3");
        statFileStub.rejects(Object.assign(new Error("File not found"), { code: "ENOENT" }));
        returnSuccessfulProcess();

        await createService().play();

        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/System/Library/Sounds/Glass.aiff",
        ]);
    });

    test("stops playback after five seconds", async () => {
        const clock = sandbox.useFakeTimers();
        setConfiguration(true, "/sounds/long.mp3");
        const audioProcess = new TestAudioProcess();
        const killSpy = sandbox.spy(audioProcess, "kill");
        spawnProcessStub.callsFake(() => {
            setImmediate(() => audioProcess.emit("spawn"));
            return audioProcess;
        });

        const playPromise = createService().play();
        await clock.tickAsync(5_000);
        await playPromise;

        expect(killSpy).to.have.been.called;
        expect(audioProcess.killed).to.be.true;
    });

    test("uses the platform sound when no custom file is configured", async () => {
        setConfiguration(true);
        returnSuccessfulProcess();

        await createService(Constants.Platform.Windows).play();

        expect(spawnProcessStub).to.have.been.calledWith(
            "powershell.exe",
            sinon.match.array.contains([
                "[System.Media.SystemSounds]::Asterisk.Play(); Start-Sleep -Milliseconds 1000",
            ]),
        );
    });
});
