/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import { expect } from "chai";
import * as sinon from "sinon";
import { addMcpServerToWorkspace, workspaceFileSystem } from "../../../src/copilot/copilotUtils";
import * as LocConstants from "../../../src/constants/locConstants";

suite("copilotUtils Tests", () => {
    let sandbox: sinon.SinonSandbox;

    setup(() => {
        sandbox = sinon.createSandbox();
    });

    teardown(() => {
        sandbox.restore();
    });

    suite("addMcpServerToWorkspace", () => {
        test("should return error when no workspace is open", async () => {
            sandbox.stub(vscode.workspace, "workspaceFolders").value(undefined);
            const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.false;
            expect(result.error).to.equal(LocConstants.SchemaDesigner.noWorkspaceOpenForMcp);
            expect(showErrorStub).to.have.been.calledOnceWith(
                LocConstants.SchemaDesigner.noWorkspaceOpenForMcp,
            );
        });

        test("should return error when workspace folders array is empty", async () => {
            sandbox.stub(vscode.workspace, "workspaceFolders").value([]);
            const showErrorStub = sandbox.stub(vscode.window, "showErrorMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.false;
            expect(result.error).to.equal(LocConstants.SchemaDesigner.noWorkspaceOpenForMcp);
            expect(showErrorStub).to.have.been.calledOnce;
        });

        test("should create mcp.json when file does not exist", async () => {
            const workspaceUri = vscode.Uri.file("/test/workspace");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            const readFileStub = sandbox
                .stub(workspaceFileSystem, "readFile")
                .rejects(new Error("File not found"));
            const writeFileStub = sandbox.stub(workspaceFileSystem, "writeFile").resolves();
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.true;
            expect(readFileStub).to.have.been.calledOnce;
            expect(writeFileStub).to.have.been.calledOnce;

            const writtenContent = JSON.parse(
                new TextDecoder().decode(writeFileStub.firstCall.args[1] as Uint8Array),
            );
            expect(writtenContent.servers.TestMcp).to.deep.equal({
                type: "http",
                url: "http://localhost:5000/mcp",
            });
            expect(showInfoStub).to.have.been.calledOnceWith(
                LocConstants.SchemaDesigner.mcpServerAddedToWorkspace(".vscode/mcp.json"),
            );
        });

        test("should merge into existing mcp.json preserving other servers", async () => {
            const workspaceUri = vscode.Uri.file("/test/workspace");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            const existingConfig = {
                servers: {
                    ExistingServer: {
                        type: "stdio",
                        command: "node",
                        args: ["server.js"],
                    },
                },
                inputs: [],
            };
            sandbox
                .stub(workspaceFileSystem, "readFile")
                .resolves(new TextEncoder().encode(JSON.stringify(existingConfig)));
            const writeFileStub = sandbox.stub(workspaceFileSystem, "writeFile").resolves();
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.true;
            const writtenContent = JSON.parse(
                new TextDecoder().decode(writeFileStub.firstCall.args[1] as Uint8Array),
            );
            expect(writtenContent.servers.ExistingServer).to.deep.equal(
                existingConfig.servers.ExistingServer,
            );
            expect(writtenContent.servers.TestMcp).to.deep.equal({
                type: "http",
                url: "http://localhost:5000/mcp",
            });
            expect(writtenContent.inputs).to.deep.equal([]);
        });

        test("should skip adding when server with same URL already exists", async () => {
            const workspaceUri = vscode.Uri.file("/test/workspace");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            const existingConfig = {
                servers: {
                    OtherName: {
                        type: "http",
                        url: "http://localhost:5000/mcp",
                    },
                },
            };
            sandbox
                .stub(workspaceFileSystem, "readFile")
                .resolves(new TextEncoder().encode(JSON.stringify(existingConfig)));
            const writeFileStub = sandbox.stub(workspaceFileSystem, "writeFile").resolves();
            const showInfoStub = sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.true;
            expect(writeFileStub).to.not.have.been.called;
            expect(showInfoStub).to.have.been.calledOnceWith(
                LocConstants.SchemaDesigner.mcpServerAlreadyExists(".vscode/mcp.json"),
            );
        });

        test("should add server when existing file has different URL", async () => {
            const workspaceUri = vscode.Uri.file("/test/workspace");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            const existingConfig = {
                servers: {
                    OtherMcp: {
                        type: "http",
                        url: "http://localhost:3000/mcp",
                    },
                },
            };
            sandbox
                .stub(workspaceFileSystem, "readFile")
                .resolves(new TextEncoder().encode(JSON.stringify(existingConfig)));
            const writeFileStub = sandbox.stub(workspaceFileSystem, "writeFile").resolves();
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.true;
            expect(writeFileStub).to.have.been.calledOnce;
            const writtenContent = JSON.parse(
                new TextDecoder().decode(writeFileStub.firstCall.args[1] as Uint8Array),
            );
            expect(writtenContent.servers.TestMcp).to.deep.equal({
                type: "http",
                url: "http://localhost:5000/mcp",
            });
        });

        test("should handle existing file with no servers key", async () => {
            const workspaceUri = vscode.Uri.file("/test/workspace");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            sandbox
                .stub(workspaceFileSystem, "readFile")
                .resolves(new TextEncoder().encode(JSON.stringify({ inputs: [] })));
            const writeFileStub = sandbox.stub(workspaceFileSystem, "writeFile").resolves();
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.true;
            const writtenContent = JSON.parse(
                new TextDecoder().decode(writeFileStub.firstCall.args[1] as Uint8Array),
            );
            expect(writtenContent.servers.TestMcp).to.deep.equal({
                type: "http",
                url: "http://localhost:5000/mcp",
            });
            expect(writtenContent.inputs).to.deep.equal([]);
        });

        test("should return error when writeFile fails", async () => {
            const workspaceUri = vscode.Uri.file("/test/workspace");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            sandbox.stub(workspaceFileSystem, "readFile").rejects(new Error("File not found"));
            sandbox.stub(workspaceFileSystem, "writeFile").rejects(new Error("Permission denied"));

            const result = await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            expect(result.success).to.be.false;
            expect(result.error).to.include("Permission denied");
        });

        test("should write to correct path in first workspace folder", async () => {
            const workspaceUri = vscode.Uri.file("/my/project");
            sandbox.stub(vscode.workspace, "workspaceFolders").value([{ uri: workspaceUri }]);

            sandbox.stub(workspaceFileSystem, "readFile").rejects(new Error("File not found"));
            const writeFileStub = sandbox.stub(workspaceFileSystem, "writeFile").resolves();
            sandbox.stub(vscode.window, "showInformationMessage").resolves();

            await addMcpServerToWorkspace("TestMcp", "http://localhost:5000/mcp");

            const writtenPath = writeFileStub.firstCall.args[0] as vscode.Uri;
            expect(writtenPath.path).to.include(".vscode/mcp.json");
        });
    });
});
