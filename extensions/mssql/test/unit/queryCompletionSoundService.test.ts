/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as childProcess from "child_process";
import { Stats } from "fs";
import * as fsPromises from "fs/promises";
import * as os from "os";
import * as chai from "chai";
import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as vscode from "vscode";
import * as Constants from "../../src/constants/constants";
import { logger } from "../../src/models/logger";
import { QueryCompletionSoundService } from "../../src/services/queryCompletionSoundService";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import * as stubs from "./stubs";
import { stubTelemetry } from "./utils";

const { expect } = chai;
chai.use(sinonChai);

suite("QueryCompletionSoundService", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let spawnProcessStub: sinon.SinonStub;
    let statFileStub: sinon.SinonStub;
    let platformStub: sinon.SinonStub;
    let sendErrorEvent: sinon.SinonStub;
    let loggerWarnStub: sinon.SinonStub;
    let loggerErrorStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
        spawnProcessStub = sandbox.stub(childProcess, "spawn");
        statFileStub = sandbox.stub(fsPromises, "stat").resolves({
            isFile: () => true,
            size: 1024,
        } as Stats);
        platformStub = sandbox.stub(os, "platform").returns(Constants.Platform.Mac);
        sandbox.stub(os, "arch").returns("test-architecture");
        sandbox.stub(os, "homedir").returns("/home/test-user");
        sandbox.stub(os, "type").returns("test-os");
        sandbox.stub(os, "release").returns("test-release");
        sandbox.stub(os, "version").returns("test-version");
        ({ sendErrorEvent } = stubTelemetry(sandbox));
        sandbox.stub(logger, "withPrefix").returns(logger);
        loggerWarnStub = sandbox.stub(logger, "warn");
        loggerErrorStub = sandbox.stub(logger, "error");
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
        platformStub.returns(platform);
        return new QueryCompletionSoundService("/extension");
    }

    function returnSuccessfulProcess(): void {
        spawnProcessStub.callsFake(() => {
            const audioProcess = new childProcess.ChildProcess();
            setImmediate(() => {
                audioProcess.emit("spawn");
                audioProcess.emit("close", 0, null);
            });
            return audioProcess;
        });
    }

    function createProcessThatClosesWith(code: number): childProcess.ChildProcess {
        const audioProcess = new childProcess.ChildProcess();
        setImmediate(() => {
            audioProcess.emit("spawn");
            audioProcess.emit("close", code, null);
        });
        return audioProcess;
    }

    test("does not start a player when the setting is disabled", async () => {
        setConfiguration(false, "/sounds/complete.wav");

        await createService().play();

        expect(spawnProcessStub).not.to.have.been.called;
    });

    test("plays a configured WAV file", async () => {
        setConfiguration(true, "/sounds/complete.wav");
        returnSuccessfulProcess();

        await createService().play();

        expect(spawnProcessStub).to.have.been.calledWith(
            "/usr/bin/afplay",
            ["/sounds/complete.wav"],
            sinon.match({
                windowsHide: true,
                stdio: "ignore",
            }),
        );
    });

    test("plays a configured WAV file that is exactly 400 KB", async () => {
        setConfiguration(true, "/sounds/complete.wav");
        statFileStub.resolves({
            isFile: () => true,
            size: 400 * 1024,
        } as Stats);
        returnSuccessfulProcess();

        await createService().play();

        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/sounds/complete.wav",
        ]);
        expect(loggerErrorStub).not.to.have.been.called;
    });

    test("uses the bundled default when the configured WAV is larger than 400 KB", async () => {
        setConfiguration(true, "/sounds/large.wav");
        statFileStub.resolves({
            isFile: () => true,
            size: 400 * 1024 + 1,
        } as Stats);
        returnSuccessfulProcess();

        await createService().play();

        expect(spawnProcessStub).not.to.have.been.calledWith("/usr/bin/afplay", [
            "/sounds/large.wav",
        ]);
        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/extension/media/query-complete.wav",
        ]);
        expect(loggerErrorStub).to.have.been.calledWith(
            'The configured query completion sound "/sounds/large.wav" is larger than 400 KB and will not be played. Using default sound instead.',
        );
    });

    test("expands the home directory in a configured path", async () => {
        setConfiguration(true, "~/sounds/complete.wav");
        returnSuccessfulProcess();

        await createService().play();

        expect(statFileStub).to.have.been.calledWith("/home/test-user/sounds/complete.wav");
        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/home/test-user/sounds/complete.wav",
        ]);
    });

    test("expands a forward-slash home directory path on Windows", async () => {
        setConfiguration(true, "~/sounds/complete.wav");
        returnSuccessfulProcess();

        await createService(Constants.Platform.Windows).play();

        expect(statFileStub).to.have.been.calledWith("/home/test-user/sounds/complete.wav");
    });

    test("plays the bundled default when the configured file type is unsupported", async () => {
        setConfiguration(true, "/sounds/complete.mp3");
        returnSuccessfulProcess();

        await createService().play();

        expect(statFileStub).not.to.have.been.called;
        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/extension/media/query-complete.wav",
        ]);
        expect(loggerWarnStub).to.have.been.calledWith(
            'The configured query completion sound "/sounds/complete.mp3" is not a WAV file. Using default sound.',
        );
    });

    test("plays the bundled default when the configured file does not exist", async () => {
        setConfiguration(true, "/sounds/missing.wav");
        statFileStub.rejects(Object.assign(new Error("File not found"), { code: "ENOENT" }));
        returnSuccessfulProcess();

        await createService().play();

        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/extension/media/query-complete.wav",
        ]);
    });

    test("stops playback after five seconds", async () => {
        const clock = sandbox.useFakeTimers();
        setConfiguration(true, "/sounds/long.wav");
        const audioProcess = new childProcess.ChildProcess();
        const killStub = sandbox.stub(audioProcess, "kill").returns(true);
        spawnProcessStub.callsFake(() => {
            setImmediate(() => audioProcess.emit("spawn"));
            return audioProcess;
        });

        const playPromise = createService().play();
        await clock.tickAsync(5_000);
        await playPromise;

        expect(killStub).to.have.been.called;
    });

    test("uses the bundled default when no custom file is configured", async () => {
        setConfiguration(true);
        returnSuccessfulProcess();

        await createService(Constants.Platform.Windows).play();

        expect(spawnProcessStub).to.have.been.calledWith(
            "powershell.exe",
            sinon.match(
                (args: string[]) =>
                    args.some((arg) => arg.includes("New-Object System.Media.SoundPlayer")),
                "PowerShell SoundPlayer command",
            ),
            sinon.match({
                env: sinon.match({
                    MSSQL_QUERY_COMPLETION_SOUND: "/extension/media/query-complete.wav",
                }),
            }),
        );
    });

    test("emits OS telemetry when no player can play the bundled default", async () => {
        setConfiguration(true);
        spawnProcessStub.callsFake(() => createProcessThatClosesWith(1));

        await createService(Constants.Platform.Linux).play();

        expect(sendErrorEvent).to.have.been.calledWith(
            TelemetryViews.QueryEditor,
            TelemetryActions.QueryCompletionSoundPlayback,
            {
                error: sinon.match({
                    message:
                        "Unable to play the bundled default query completion sound because no supported audio player could be used.",
                }),
                includeErrorMessage: true,
                additionalProps: {
                    platform: Constants.Platform.Linux,
                    architecture: "test-architecture",
                    osType: "test-os",
                    osRelease: "test-release",
                    osVersion: "test-version",
                },
            },
        );
        expect(loggerWarnStub).to.have.been.calledWith(
            "Unable to play the bundled default query completion sound because no supported audio player could be used.",
        );
    });

    test("falls back to the bundled default after a custom sound fails", async () => {
        setConfiguration(true, "/sounds/complete.wav");
        spawnProcessStub.callsFake((_command, args) =>
            createProcessThatClosesWith(args.includes("/sounds/complete.wav") ? 1 : 0),
        );

        await createService(Constants.Platform.Mac).play();

        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/sounds/complete.wav",
        ]);
        expect(spawnProcessStub).to.have.been.calledWith("/usr/bin/afplay", [
            "/extension/media/query-complete.wav",
        ]);
        expect(sendErrorEvent).not.to.have.been.called;
        expect(loggerWarnStub).to.have.been.calledWith(
            'Unable to play the custom query completion sound "/sounds/complete.wav". Using default sound instead.',
        );
    });
});
