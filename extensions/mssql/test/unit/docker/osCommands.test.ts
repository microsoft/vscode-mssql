/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import * as sinon from "sinon";
import * as childProcess from "child_process";
import * as os from "os";
import * as path from "path";
import { Platform } from "../../../src/constants/constants";
import * as osCommands from "../../../src/docker/osCommands";

chai.use(sinonChai);

suite("OS Commands", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    // Helper to create mock process that succeeds with output
    const createSuccessProcess = (output: string) => ({
        stdout: {
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "data") setTimeout(() => callback(output), 0);
            }),
            pipe: sinon.stub(),
        },
        stderr: {
            on: sinon.stub().callsFake((event, callback) => {
                if (event === "data") setTimeout(() => callback(""), 0);
            }),
        },
        stdin: { end: sinon.stub() },
        on: sinon.stub().callsFake((event, callback) => {
            if (event === "close") setTimeout(() => callback(0), 5);
            if (event === "error") {
                /* no-op for success case */
            }
        }),
    });

    // Helper to create mock process that fails
    const createFailureProcess = (error: Error) => ({
        stdout: { on: sinon.stub() },
        stderr: { on: sinon.stub() },
        on: sinon.stub().callsFake((event, callback) => {
            if (event === "error") setTimeout(() => callback(error), 0);
        }),
    });

    suite("getDockerExecutablePath", () => {
        test("should return Docker path when found", async () => {
            const spawnStub = sandbox.stub(childProcess, "spawn");
            const dockerPath = path.join(
                "C:",
                "Program Files",
                "Docker",
                "Docker",
                "resources",
                "bin",
                "docker.exe",
            );

            spawnStub.returns(createSuccessProcess(dockerPath) as any);

            const result = await osCommands.getDockerExecutablePath("DockerCli.exe");
            const expectedPath = path.join(
                "C:",
                "Program Files",
                "Docker",
                "Docker",
                "DockerCli.exe",
            );
            expect(result).to.equal(expectedPath);
        });

        test("should return empty string when Docker path structure is invalid", async () => {
            const spawnStub = sandbox.stub(childProcess, "spawn");
            const invalidPath = path.join("C:", "No", "Docker", "Here", "docker.exe");

            spawnStub.returns(createSuccessProcess(invalidPath) as any);

            const result = await osCommands.getDockerExecutablePath("DockerCli.exe");
            expect(result).to.equal("");
        });

        test("should return empty string when command fails", async () => {
            const spawnStub = sandbox.stub(childProcess, "spawn");

            spawnStub.returns(createFailureProcess(new Error("Command failed")) as any);

            const result = await osCommands.getDockerExecutablePath("DockerCli.exe");
            expect(result).to.equal("");
        });
    });

    suite("getStartDockerCommand", () => {
        test("should return Windows command on Windows", () => {
            sandbox.stub(os, "platform").returns(Platform.Windows);
            const dockerPath = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";

            const result = osCommands.getStartDockerCommand(dockerPath);

            expect(result).to.not.be.undefined;
            expect(result!.command).to.equal("cmd.exe");
            expect(result!.args).to.include(dockerPath);
        });

        test("should return macOS command on Darwin", () => {
            sandbox.stub(os, "platform").returns(Platform.Mac);

            const result = osCommands.getStartDockerCommand("");

            expect(result).to.not.be.undefined;
            expect(result!.command).to.equal("open");
            expect(result!.args).to.deep.equal(["-a", "Docker"]);
        });

        test("should return Linux command on Linux", () => {
            sandbox.stub(os, "platform").returns(Platform.Linux);

            const result = osCommands.getStartDockerCommand("");

            expect(result).to.not.be.undefined;
            expect(result!.command).to.equal("systemctl");
            expect(result!.args).to.deep.equal(["start", "docker"]);
        });

        test("should return undefined on unsupported platform", () => {
            sandbox.stub(os, "platform").returns("freebsd" as any);

            const result = osCommands.getStartDockerCommand("");

            expect(result).to.be.undefined;
        });
    });

    suite("execCommand", () => {
        test("should return stdout on success", async () => {
            const spawnStub = sandbox.stub(childProcess, "spawn");
            spawnStub.returns(createSuccessProcess("command output") as any);

            const result = await osCommands.execCommand({
                command: "echo",
                args: ["test"],
            });

            expect(result).to.equal("command output");
        });

        test("should reject on error", async () => {
            const spawnStub = sandbox.stub(childProcess, "spawn");
            spawnStub.returns(createFailureProcess(new Error("Command failed")) as any);

            try {
                await osCommands.execCommand({
                    command: "invalid",
                    args: [],
                });
                expect.fail("Should have thrown an error");
            } catch (e) {
                expect((e as Error).message).to.equal("Command failed");
            }
        });
    });

    suite("execCommandWithPipe", () => {
        test("should pipe output from first command to second", async () => {
            const spawnStub = sandbox.stub(childProcess, "spawn");

            // First process (cat)
            const process1 = {
                stdout: {
                    on: sinon.stub(),
                    pipe: sinon.stub(),
                },
                stderr: { on: sinon.stub() },
                on: sinon.stub(),
            };

            // Second process (grep)
            const process2 = {
                stdout: {
                    on: sinon.stub().callsFake((event, callback) => {
                        if (event === "data") setTimeout(() => callback("matched line"), 0);
                    }),
                },
                stdin: {},
                stderr: { on: sinon.stub() },
                on: sinon.stub().callsFake((event, callback) => {
                    if (event === "close") setTimeout(() => callback(0), 5);
                }),
            };

            spawnStub.onFirstCall().returns(process1 as any);
            spawnStub.onSecondCall().returns(process2 as any);

            const result = await osCommands.execCommandWithPipe(
                { command: "cat", args: ["file.txt"] },
                { command: "grep", args: ["pattern"] },
            );

            expect(result).to.equal("matched line");
            expect(process1.stdout.pipe).to.have.been.calledWith(process2.stdin);
        });
    });

    suite("OS_COMMANDS", () => {
        test("GET_DOCKER_PATH should return PowerShell command", () => {
            const cmd = osCommands.OS_COMMANDS.GET_DOCKER_PATH();
            expect(cmd.command).to.equal("powershell.exe");
            expect(cmd.args).to.include("-Command");
        });

        test("SWITCH_TO_LINUX_ENGINE should return correct command", () => {
            const dockerCliPath = "C:\\Program Files\\Docker\\Docker\\DockerCli.exe";
            const cmd = osCommands.OS_COMMANDS.SWITCH_TO_LINUX_ENGINE(dockerCliPath);
            expect(cmd.command).to.equal("powershell.exe");
            expect(cmd.args.join(" ")).to.include(dockerCliPath);
            expect(cmd.args.join(" ")).to.include("-SwitchLinuxEngine");
        });

        test("CHECK_ROSETTA should have docker and grep commands", () => {
            const rosetta = osCommands.OS_COMMANDS.CHECK_ROSETTA;
            expect(rosetta.dockerCmd.command).to.equal("cat");
            expect(rosetta.grepCmd.command).to.equal("grep");
            expect(rosetta.grepCmd.args).to.include('"UseVirtualizationFrameworkRosetta": true');
        });

        test("START_DOCKER should return platform-specific commands", () => {
            const dockerPath = "C:\\Docker\\Docker Desktop.exe";
            const commands = osCommands.OS_COMMANDS.START_DOCKER(dockerPath);

            expect(commands.win32.command).to.equal("cmd.exe");
            expect(commands.darwin.command).to.equal("open");
            expect(commands.linux.command).to.equal("systemctl");
        });
    });
});
