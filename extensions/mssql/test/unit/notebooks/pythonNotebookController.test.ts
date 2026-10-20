/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscode from "vscode";
import * as path from "path";
import { expect, use } from "chai";
import sinonChai from "sinon-chai";
import type { Jupyter, Kernel } from "@vscode/jupyter-extension";
import {
    createPythonNotebookData,
    getPythonNotebookReference,
    PythonNotebookController,
} from "../../../src/notebooks/pythonNotebookController";
import ConnectionManager from "../../../src/controllers/connectionManager";
import { PythonNotebooks } from "../../../src/constants/locConstants";
import { ConnectionStore } from "../../../src/models/connectionStore";
import { ConnectionConfig } from "../../../src/connectionconfig/connectionconfig";
import { IConnectionProfile } from "../../../src/models/interfaces";
import { PythonNotebookCredentialsProvider } from "../../../src/notebooks/pythonNotebookCredentials";
import { PythonNotebookSessionBroker } from "../../../src/notebooks/pythonNotebookSessionBroker";
import { PythonNotebookIntellisense } from "../../../src/notebooks/pythonNotebookIntellisense";
import * as Constants from "../../../src/constants/constants";
import { ConnectionUI } from "../../../src/views/connectionUI";
import { stubMessageBoxes, stubTelemetry } from "../utils";

use(sinonChai);

suite("PythonNotebookController", () => {
    let sandbox: sinon.SinonSandbox;
    let controller: PythonNotebookController;
    let document: vscode.NotebookDocument;
    let kernel: Kernel;
    let getKernel: sinon.SinonStub;
    let execute: sinon.SinonStub<
        Parameters<Kernel["executeCode"]>,
        ReturnType<Kernel["executeCode"]>
    >;
    let consent: sinon.SinonStub;
    let enabled: sinon.SinonStub;
    let revoke: sinon.SinonStub;
    let configuration: sinon.SinonStub;
    let createSession: sinon.SinonStub;
    let manager: sinon.SinonStubbedInstance<ConnectionManager>;
    let profile: IConnectionProfile;
    let status: vscode.EventEmitter<Kernel["status"]>;
    let trusted: boolean;
    let authorizeIntellisense: sinon.SinonStub;
    let revokeIntellisense: sinon.SinonStub;
    let information: sinon.SinonStub;
    let commands: sinon.SinonStub;
    let cells: vscode.NotebookCell[];
    let changes: vscode.EventEmitter<vscode.NotebookDocumentChangeEvent>;
    let configurationChanges: vscode.EventEmitter<vscode.ConfigurationChangeEvent>;
    let connectionUI: sinon.SinonStubbedInstance<ConnectionUI>;
    const reference = { version: 1, connectionId: "selected-id", database: "selected-db" } as const;

    setup(() => {
        sandbox = sinon.createSandbox();
        trusted = true;
        enabled = sandbox.stub().returns(true);
        sandbox.stub(vscode.workspace, "getConfiguration").returns({
            get: enabled,
            has: () => true,
            inspect: () => undefined,
            update: async () => undefined,
        });
        sandbox.stub(vscode.workspace, "isTrusted").get(() => trusted);
        document = {
            uri: vscode.Uri.file("C:\\notebook.ipynb"),
            notebookType: "jupyter-notebook",
            metadata: createPythonNotebookData(reference).metadata,
            isClosed: false,
            getCells: () => cells,
            cellAt: (index: number) => cells[index],
        } as vscode.NotebookDocument;
        cells = [cell("pass")];
        changes = new vscode.EventEmitter<vscode.NotebookDocumentChangeEvent>();
        sandbox.stub(vscode.workspace, "onDidChangeNotebookDocument").callsFake(changes.event);
        configurationChanges = new vscode.EventEmitter<vscode.ConfigurationChangeEvent>();
        sandbox
            .stub(vscode.workspace, "onDidChangeConfiguration")
            .callsFake(configurationChanges.event);
        sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake(() => new vscode.Disposable(() => undefined));
        commands = sandbox.stub(vscode.commands, "executeCommand").resolves();
        commands.withArgs("notebook.selectKernel").resolves(false);
        sandbox.stub(vscode.window, "showNotebookDocument").callsFake(async () => {
            return { notebook: document } as vscode.NotebookEditor;
        });
        sandbox.stub(vscode.window, "activeNotebookEditor").get(() => ({ notebook: document }));
        const messages = stubMessageBoxes(sandbox);
        consent = messages.showWarningMessage;
        information = messages.showInformationMessage;
        consent.callsFake(sandbox.stub().resolves(PythonNotebooks.allow));
        stubTelemetry(sandbox);
        sandbox.stub(vscode.window, "withProgress").callsFake(async (_options, task) => {
            const source = new vscode.CancellationTokenSource();
            try {
                return await task({ report: () => undefined }, source.token);
            } finally {
                source.dispose();
            }
        });
        status = new vscode.EventEmitter<Kernel["status"]>();
        execute = sandbox.stub();
        execute.callsFake(async function* (code) {
            const marker = code.includes("_mssql_ready")
                ? "__MSSQL_PYTHON_READY__"
                : code.includes("_mssql_runtime.initialize")
                  ? '__MSSQL_PYTHON_DATABASE__"selected-db"\n__MSSQL_PYTHON_CONNECTED__'
                  : "";
            yield { items: [vscode.NotebookCellOutputItem.stdout(marker + "\n")] };
        });
        kernel = {
            status: "idle",
            language: "python",
            onDidChangeStatus: status.event,
            executeCode: execute,
        };
        getKernel = sandbox.stub().resolves(kernel);
        const api: Jupyter = {
            kernels: { getKernel },
            createJupyterServerCollection: sandbox.stub(),
        };
        sandbox.stub(vscode.extensions, "getExtension").returns({
            id: "ms-toolsai.jupyter",
            extensionUri: vscode.Uri.file("C:\\jupyter"),
            extensionPath: "C:\\jupyter",
            isActive: true,
            packageJSON: {},
            exports: api,
            extensionKind: vscode.ExtensionKind.Workspace,
            activate: async () => api,
        });
        configuration = sandbox
            .stub(PythonNotebookCredentialsProvider.prototype, "getConfiguration")
            .resolves({
                settings: {
                    server: "server",
                    database: "selected-db",
                    encrypt: "yes",
                    trustServerCertificate: false,
                    loginTimeout: 15,
                    queryTimeout: 30,
                },
                authentication: { kind: "sql", username: "user", password: "synthetic-secret" },
            });
        createSession = sandbox
            .stub(PythonNotebookSessionBroker.prototype, "createSession")
            .resolves({
                brokerUrl: "http://127.0.0.1:1234",
                capability: "synthetic-capability",
            });
        revoke = sandbox.stub(PythonNotebookSessionBroker.prototype, "revoke");
        revokeIntellisense = sandbox.stub();
        authorizeIntellisense = sandbox
            .stub(PythonNotebookIntellisense.prototype, "authorize")
            .returns(new vscode.Disposable(revokeIntellisense));
        manager = sandbox.createStubInstance(ConnectionManager);
        manager.prepareConnectionInfo.callsFake(async (info) => info);
        const store = sandbox.createStubInstance(ConnectionStore);
        const config = sandbox.createStubInstance(ConnectionConfig);
        sandbox.stub(manager, "connectionStore").get(() => store);
        sandbox.stub(store, "connectionConfig").get(() => config);
        connectionUI = sandbox.createStubInstance(ConnectionUI);
        sandbox.stub(manager, "connectionUI").get(() => connectionUI);
        store.getProfilePickListItems.resolves([]);
        profile = {
            id: reference.connectionId,
            server: "server",
            database: "profile-db",
            authenticationType: "SqlLogin",
            user: "user",
            password: "synthetic-secret",
        } as IConnectionProfile;
        config.getConnections.resolves([profile]);
        connectionUI.promptForConnection.resolves(profile);
        controller = new PythonNotebookController(
            {
                extensionUri: vscode.Uri.file(path.resolve(__dirname, "..", "..", "..", "..")),
                subscriptions: [],
            } as vscode.ExtensionContext,
            manager,
        );
    });

    teardown(async () => {
        try {
            await controller?.dispose();
        } finally {
            status?.dispose();
            changes?.dispose();
            configurationChanges?.dispose();
            sandbox.restore();
        }
    });

    function cell(source: string, languageId = "python"): vscode.NotebookCell {
        return {
            kind: vscode.NotebookCellKind.Code,
            index: 0,
            notebook: document,
            metadata: {},
            document: {
                languageId,
                getText: () => source,
                uri: vscode.Uri.parse("vscode-notebook-cell:/notebook.ipynb#cell"),
            },
        } as vscode.NotebookCell;
    }

    test("offers Connect once for an unconnected MSSQL notebook without touching its kernel", async () => {
        await controller.handleNotebookOpened(document);
        await controller.handleNotebookOpened(document);
        const prompts = information.getCalls().filter((call) => call.args.includes("Connect"));
        expect(prompts).to.have.length(1);
        expect(getKernel).not.to.have.been.called;
        expect(execute).not.to.have.been.called;
        expect(configuration).not.to.have.been.called;
    });

    test("offers Connect for a generic Python notebook containing a header-only tsql magic", async () => {
        document = { ...document, metadata: { metadata: { language_info: { name: "python" } } } };
        cells = [cell("%%tsql")];
        await controller.handleNotebookOpened(document);
        expect(information).to.have.been.calledWith(sinon.match.string, "Connect", "Not Now");
    });

    test("does not prompt for ordinary Python or native SQL cells", async () => {
        document = { ...document, metadata: {} };
        cells = [cell("print('%%tsql is not a magic header')")];
        await controller.handleNotebookOpened(document);
        cells = [cell("SELECT 1", "sql")];
        await controller.handleNotebookOpened(document);
        expect(information).not.to.have.been.called;
    });

    test("does not prompt in an untrusted or disabled workspace", async () => {
        trusted = false;
        await controller.handleNotebookOpened(document);
        trusted = true;
        enabled.returns(false);
        await controller.handleNotebookOpened(document);
        expect(information).not.to.have.been.called;
    });

    test("the Connect toast focuses its originating notebook and invokes the connection flow", async () => {
        information.resolves("Connect");
        await controller.handleNotebookOpened(document);
        expect(vscode.window.showNotebookDocument).to.have.been.calledWith(document);
        expect(commands).to.have.been.calledWith(Constants.cmdNotebooksConnectPython);
        expect(execute).not.to.have.been.called;
    });

    test("ignores a Connect action after its notebook closes", async () => {
        information.callsFake(async () => {
            Object.defineProperty(document, "isClosed", { value: true });
            return "Connect";
        });
        await controller.handleNotebookOpened(document);
        expect(commands).not.to.have.been.calledWith(Constants.cmdNotebooksConnectPython);
    });

    test("updates toolbar context when the active notebook connects and disconnects", async () => {
        await controller.handleNotebookOpened(document);
        expect(commands).to.have.been.calledWith("setContext", "mssql.pythonNotebook", true);
        await controller.connect();
        expect(commands).to.have.been.calledWith(
            "setContext",
            "mssql.pythonNotebookConnected",
            true,
        );
        commands.resetHistory();
        await controller.disconnect();
        expect(commands).to.have.been.calledWith(
            "setContext",
            "mssql.pythonNotebookConnected",
            false,
        );
        information.resetHistory();
        await controller.handleNotebookOpened(document);
        expect(information).not.to.have.been.called;
    });

    test("offers Reconnect after a kernel restart without reconnecting automatically", async () => {
        await controller.connect();
        information.resetHistory();
        status.fire("restarting");
        await controller.handleNotebookOpened(document);
        expect(information).to.have.been.calledWith(sinon.match.string, "Reconnect", "Not Now");
        expect(commands).not.to.have.been.calledWith(Constants.cmdNotebooksConnectPython);
        expect(revokeIntellisense).to.have.been.called;
    });

    test("associates a generic notebook with a selected connection without saving credentials", async () => {
        document = {
            ...document,
            metadata: { metadata: { language_info: { name: "python" }, custom_value: 42 } },
        };
        cells = [cell("%%tsql\nSELECT 1")];
        let metadata: Record<string, unknown> | undefined;
        const updateMetadata = vscode.NotebookEdit.updateNotebookMetadata;
        sandbox.stub(vscode.NotebookEdit, "updateNotebookMetadata").callsFake((value) => {
            metadata = value;
            return updateMetadata(value);
        });
        sandbox.stub(vscode.workspace, "applyEdit").callsFake(async () => {
            Object.defineProperty(document, "metadata", { value: metadata });
            return true;
        });
        await controller.connect();
        expect(connectionUI.promptForConnection).to.have.been.called;
        expect(getPythonNotebookReference(document)).to.deep.equal({
            version: 1,
            connectionId: profile.id,
            database: profile.database,
        });
        expect(document.metadata.metadata.custom_value).to.equal(42);
        expect(JSON.stringify(document.metadata)).not.to.match(
            /synthetic|password|capability|brokerUrl/,
        );
        expect(authorizeIntellisense).to.have.been.calledWith(document);
    });

    test("cancelling connection selection leaves a generic notebook unchanged", async () => {
        document = { ...document, metadata: {} };
        connectionUI.promptForConnection.resolves(undefined);
        await rejects(controller.connect(), "Canceled");
        expect(document.metadata).to.deep.equal({});
        expect(execute).not.to.have.been.called;
        expect(createSession).not.to.have.been.called;
    });

    test("starts only a safe initialization cell when Connect needs a kernel", async () => {
        getKernel.resolves(undefined);
        commands.withArgs("notebook.selectKernel").resolves(true);
        commands.withArgs("notebook.cell.execute").callsFake(async () => {
            getKernel.resolves(kernel);
            changes.fire({
                notebook: document,
                metadata: undefined,
                cellChanges: [
                    {
                        cell: cells[0],
                        document: undefined,
                        metadata: undefined,
                        outputs: undefined,
                        executionSummary: { success: true },
                    },
                ],
                contentChanges: [],
            } as vscode.NotebookDocumentChangeEvent);
        });
        await controller.connect();
        expect(commands).to.have.been.calledWithExactly(
            "notebook.selectKernel",
            sinon.match({
                notebookEditor: sinon.match.has("notebook", sinon.match.same(document)),
            }),
        );
        expect(commands).to.have.been.calledWith("notebook.cell.execute", {
            document: document.uri,
            ranges: [{ start: 0, end: 1 }],
        });
        expect(authorizeIntellisense).to.have.been.called;
    });

    test("detects a newly inserted tsql cell without requiring an editor switch", async () => {
        document = { ...document, metadata: {} };
        cells = [cell("%%tsql\nSELECT 1")];
        changes.fire({
            notebook: document,
            metadata: undefined,
            cellChanges: [],
            contentChanges: [
                { range: new vscode.NotebookRange(0, 0), addedCells: cells, removedCells: [] },
            ],
        });
        await new Promise<void>(setImmediate);
        expect(information).to.have.been.calledWith(sinon.match.string, "Connect", "Not Now");
    });

    test("never runs an existing SQL cell to initialize a kernel", async () => {
        const sqlCell = cell("%%tsql\nDELETE FROM important_table;");
        cells = [sqlCell];
        getKernel.resolves(undefined);
        commands.withArgs("notebook.selectKernel").resolves(true);
        const insertCells = vscode.NotebookEdit.insertCells;
        sandbox.stub(vscode.NotebookEdit, "insertCells").callsFake((index, inserted) => {
            expect(index).to.equal(0);
            expect(inserted.map((item) => item.value)).to.deep.equal(["pass"]);
            return insertCells(index, inserted);
        });
        sandbox.stub(vscode.workspace, "applyEdit").callsFake(async () => {
            cells = [cell("pass"), sqlCell];
            return true;
        });
        commands.withArgs("notebook.cell.execute").callsFake(async () => {
            getKernel.resolves(kernel);
            changes.fire({
                notebook: document,
                metadata: undefined,
                cellChanges: [
                    {
                        cell: cells[0],
                        document: undefined,
                        metadata: undefined,
                        outputs: undefined,
                        executionSummary: { success: true },
                    },
                ],
                contentChanges: [],
            } as vscode.NotebookDocumentChangeEvent);
        });
        await controller.connect();
        expect(commands).to.have.been.calledWith("notebook.cell.execute", {
            document: document.uri,
            ranges: [{ start: 0, end: 1 }],
        });
        expect(sqlCell.document.getText()).to.equal("%%tsql\nDELETE FROM important_table;");
    });

    test("failed metadata persistence does not grant a generic notebook a session", async () => {
        document = { ...document, metadata: {} };
        sandbox.stub(vscode.workspace, "applyEdit").resolves(false);
        await rejects(controller.connect(), PythonNotebooks.errors.initialization);
        expect(createSession).not.to.have.been.called;
        expect(authorizeIntellisense).not.to.have.been.called;
    });

    test("leaves generic notebook metadata unchanged when credential consent is declined", async () => {
        document = { ...document, metadata: {} };
        consent.resolves(undefined);
        const edit = sandbox.stub(vscode.workspace, "applyEdit").resolves(true);
        await rejects(controller.connect(), "Canceled");
        expect(edit).not.to.have.been.called;
        expect(configuration).not.to.have.been.called;
    });

    test("restores SQL controls after switching through an unrelated notebook", async () => {
        await controller.connect();
        const connectedDocument = document;
        const connectedCells = cells;
        commands.resetHistory();
        document = { ...document, metadata: {}, uri: vscode.Uri.file("C:\\plain.ipynb") };
        cells = [cell("print(1)")];
        await controller.handleNotebookOpened(document);
        expect(commands).to.have.been.calledWith("setContext", "mssql.pythonNotebook", false);
        expect(commands).to.have.been.calledWith(
            "setContext",
            "mssql.pythonNotebookConnected",
            false,
        );
        document = connectedDocument;
        cells = connectedCells;
        commands.resetHistory();
        information.resetHistory();
        await controller.handleNotebookOpened(document);
        expect(commands).to.have.been.calledWith("setContext", "mssql.pythonNotebook", true);
        expect(commands).to.have.been.calledWith(
            "setContext",
            "mssql.pythonNotebookConnected",
            true,
        );
        expect(information).not.to.have.been.called;
    });

    test("rechecks dependencies after guided installation before creating a credential session", async () => {
        consent.callsFake(async (message) =>
            message === PythonNotebooks.errors.dependencies
                ? PythonNotebooks.installAndConnect
                : message === PythonNotebooks.installConsent
                  ? PythonNotebooks.install
                  : PythonNotebooks.allow,
        );
        let probes = 0;
        execute.callsFake(async function* (code) {
            if (code.includes("_mssql_ready")) {
                probes++;
                yield {
                    items: [
                        vscode.NotebookCellOutputItem.stdout("__MSSQL_DEPENDENCIES_MISSING__\n"),
                    ],
                };
            }
        });
        await rejects(controller.connect(), PythonNotebooks.errors.dependencies);
        expect(probes).to.equal(2);
        expect(createSession).not.to.have.been.called;
    });

    test("requires a user-approved restart instead of authorizing a stale loaded dependency", async () => {
        execute.callsFake(async function* (code) {
            yield {
                items: [
                    vscode.NotebookCellOutputItem.stdout(
                        code.includes("_mssql_ready") || code.includes("check_dependencies")
                            ? "__MSSQL_PYTHON_RESTART__\n"
                            : "",
                    ),
                ],
            };
        });
        consent.callsFake(async (message) =>
            message === PythonNotebooks.consent("server", "selected-db")
                ? PythonNotebooks.allow
                : "Restart Kernel",
        );
        await rejects(controller.connect(), "Canceled");
        expect(commands).to.have.been.calledWith("notebook.restartKernel", document.uri);
        expect(createSession).not.to.have.been.called;
        expect(authorizeIntellisense).not.to.have.been.called;
    });

    test("does not restart or authorize when the dependency restart warning is dismissed", async () => {
        execute.callsFake(async function* () {
            yield {
                items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_PYTHON_RESTART__\n")],
            };
        });
        consent.callsFake(async (message) =>
            message === PythonNotebooks.errors.dependencies ? undefined : PythonNotebooks.allow,
        );
        await rejects(controller.connect(), "Canceled");
        expect(commands).not.to.have.been.calledWith("notebook.restartKernel");
        expect(createSession).not.to.have.been.called;
    });

    test("requires restart and reconnect after explicitly approved dependency installation", async () => {
        consent.callsFake(async (message) =>
            message === PythonNotebooks.errors.dependencies
                ? PythonNotebooks.installAndConnect
                : message === PythonNotebooks.installConsent
                  ? PythonNotebooks.install
                  : message === PythonNotebooks.restartConsent
                    ? PythonNotebooks.restartKernel
                    : PythonNotebooks.allow,
        );
        let installed = false;
        execute.callsFake(async function* (code) {
            if (code.includes("'pip', 'install'")) installed = true;
            const marker = code.includes("_mssql_ready")
                ? installed
                    ? "__MSSQL_PYTHON_READY__"
                    : "__MSSQL_DEPENDENCIES_MISSING__"
                : code.includes("_mssql_runtime.initialize")
                  ? '__MSSQL_PYTHON_DATABASE__"selected-db"\n__MSSQL_PYTHON_CONNECTED__'
                  : "";
            yield { items: [vscode.NotebookCellOutputItem.stdout(marker + "\n")] };
        });
        await rejects(controller.connect(), "Canceled");
        expect(installed).to.equal(true);
        expect(consent).to.have.been.calledWith(
            PythonNotebooks.installConsent,
            { modal: true },
            PythonNotebooks.install,
        );
        expect(commands).to.have.been.calledWith("notebook.restartKernel", document.uri);
        expect(authorizeIntellisense).not.to.have.been.called;
        expect(createSession).not.to.have.been.called;
    });

    test("Disconnect also cancels guided dependency installation", async () => {
        consent.callsFake(async (message) =>
            message === PythonNotebooks.errors.dependencies
                ? PythonNotebooks.installAndConnect
                : message === PythonNotebooks.installConsent
                  ? PythonNotebooks.install
                  : PythonNotebooks.allow,
        );
        let installationCancelled = false;
        execute.callsFake(async function* (code, token) {
            if (code.includes("'pip', 'install'")) {
                await controller.disconnect();
                installationCancelled = token.isCancellationRequested;
            }
            yield {
                items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_DEPENDENCIES_MISSING__\n")],
            };
        });
        await rejects(controller.connect(), "Canceled");
        expect(installationCancelled).to.equal(true);
        expect(createSession).not.to.have.been.called;
    });

    async function rejects(action: Promise<unknown>, message: string): Promise<void> {
        try {
            await action;
        } catch (error) {
            expect((error as Error).message).to.equal(message);
            return;
        }
        expect.fail("Expected rejection");
    }

    test("creates an ordinary Python notebook without credentials or SQL metadata", () => {
        const data = createPythonNotebookData(reference);
        expect(
            data.cells
                .filter((cell) => cell.kind === vscode.NotebookCellKind.Code)
                .every((cell) => cell.languageId === "python"),
        ).to.equal(true);
        expect(data.metadata.metadata.kernelspec.language).to.equal("python");
        expect(data.metadata.metadata.kernelspec.name).to.equal("python3");
        expect(JSON.stringify(data)).not.to.match(/password|capability|brokerUrl|accessToken/);
        expect(data.cells.some((cell) => cell.value.includes("%%tsql --bind df"))).to.equal(true);
        const document = { metadata: data.metadata };
        expect(getPythonNotebookReference(document)).to.deep.equal(reference);
    });

    test("does not treat arbitrary notebooks as authorized connection references", () => {
        const document = {
            metadata: {
                metadata: { mssqlPythonNotebook: { version: 1, connectionId: 1 } },
            },
        };
        expect(getPythonNotebookReference(document)).to.equal(undefined);
    });

    test("blocks feature commands at runtime when disabled", async () => {
        enabled.returns(false);
        await rejects(controller.createNotebook(reference), PythonNotebooks.errors.disabled);
    });

    test("allows the Python Preview override without enabling other experimental features", async () => {
        enabled.returns(undefined);
        enabled.withArgs("enableExperimentalFeatures").returns(false);
        enabled.withArgs("mssql.preview.pythonNotebooks").returns(true);
        await controller.connect();
        expect(authorizeIntellisense).to.have.been.called;
        expect(commands).to.have.been.calledWith("setContext", "mssql.pythonNotebookEnabled", true);
    });

    test("the Python Preview opt-out overrides the enabled experimental umbrella", async () => {
        enabled.returns(undefined);
        enabled.withArgs("enableExperimentalFeatures").returns(true);
        enabled.withArgs("mssql.preview.pythonNotebooks").returns(false);
        await rejects(controller.connect(), PythonNotebooks.errors.disabled);
        expect(getKernel).not.to.have.been.called;
    });

    test("disabling only the Python Preview revokes existing kernel and IntelliSense access", async () => {
        await controller.connect();
        enabled.withArgs("mssql.preview.pythonNotebooks").returns(false);
        configurationChanges.fire({
            affectsConfiguration: (key) => key === "mssql.preview.pythonNotebooks",
        });
        expect(revoke).to.have.been.calledWith("synthetic-capability");
        expect(revokeIntellisense).to.have.been.called;
    });

    test("requires Workspace Trust before accessing a kernel", async () => {
        trusted = false;
        await rejects(controller.connect(), PythonNotebooks.errors.trust);
        expect(getKernel.called).to.equal(false);
    });

    test("initializes using public kernel stdout without saving bootstrap or credentials", async () => {
        const original = JSON.stringify(document.metadata);
        await controller.connect();
        expect(consent.calledWithMatch(sinon.match("selected-db"), { modal: true })).to.equal(true);
        expect(
            execute.getCalls().some((call) => call.args[0].includes("_mssql_runtime.initialize")),
        ).to.equal(true);
        expect(JSON.stringify(document.metadata)).to.equal(original);
        expect(JSON.stringify(document.metadata)).not.to.match(
            /synthetic|brokerUrl|password|token/,
        );
        await controller.disconnect();
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
        expect(
            execute.getCalls().some((call) => call.args[0].includes("_mssql_runtime.disconnect()")),
        ).to.equal(true);
    });

    test("does not execute or authorize after credential consent is declined", async () => {
        consent.resolves(undefined);
        await rejects(controller.connect(), "Canceled");
        expect(execute.called).to.equal(false);
        expect(revoke.called).to.equal(false);
        expect(authorizeIntellisense).not.to.have.been.called;
    });

    test("authorizes IntelliSense with the actual default database after kernel readiness", async () => {
        document = {
            ...document,
            metadata: createPythonNotebookData({ ...reference, database: undefined }).metadata,
        };
        profile.database = "";
        await controller.connect();
        expect(authorizeIntellisense).to.have.been.calledWith(
            document,
            sinon.match.instanceOf(PythonNotebookCredentialsProvider),
            { ...reference, database: undefined },
            "selected-db",
        );
        await controller.disconnect();
        expect(revokeIntellisense).to.have.been.called;
    });

    for (const record of [
        "",
        "__MSSQL_PYTHON_DATABASE__null\n",
        "__MSSQL_PYTHON_DATABASE__not-json\n",
    ]) {
        test(`rejects missing or malformed kernel database readiness: ${JSON.stringify(record)}`, async () => {
            execute.callsFake(async function* (code) {
                const marker = code.includes("_mssql_ready")
                    ? "__MSSQL_PYTHON_READY__"
                    : code.includes("_mssql_runtime.initialize")
                      ? `${record}__MSSQL_PYTHON_CONNECTED__`
                      : "";
                yield { items: [vscode.NotebookCellOutputItem.stdout(marker + "\n")] };
            });
            await rejects(controller.connect(), PythonNotebooks.errors.initialization);
            expect(authorizeIntellisense).not.to.have.been.called;
            expect(revoke).to.have.been.calledWith("synthetic-capability");
        });
    }

    test("rejects a server change between consent and the dependency probe completing", async () => {
        configuration.restore();
        execute.callsFake(async function* (code) {
            if (code.includes("_mssql_ready")) {
                profile.server = "unapproved-production";
                yield { items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_PYTHON_READY__\n")] };
            } else {
                yield {
                    items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_PYTHON_CONNECTED__\n")],
                };
            }
        });
        await rejects(controller.connect(), PythonNotebooks.errors.profileChanged);
        expect(consent.calledWith(PythonNotebooks.consent("server", "selected-db"))).to.equal(true);
        expect(manager.prepareConnectionInfo.called).to.equal(false);
        expect(createSession.called).to.equal(false);
    });

    test("rejects security changes while the consent dialog is open", async () => {
        configuration.restore();
        consent.callsFake(async () => {
            profile.trustServerCertificate = true;
            return PythonNotebooks.allow;
        });
        await rejects(controller.connect(), PythonNotebooks.errors.profileChanged);
        expect(createSession.called).to.equal(false);
    });

    test("uses default-database consent for an unspecified database", async () => {
        document = {
            ...document,
            metadata: createPythonNotebookData({ ...reference, database: undefined }).metadata,
        };
        profile.database = "";
        await controller.connect();
        expect(
            consent.calledWith(PythonNotebooks.consent("server", PythonNotebooks.defaultDatabase)),
        ).to.equal(true);
    });

    test("Disconnect cancels initialization and immediately revokes its capability", async () => {
        let started: () => void;
        let complete: () => void;
        let initializationToken: vscode.CancellationToken | undefined;
        const initializing = new Promise<void>((resolve) => (started = resolve));
        const completion = new Promise<void>((resolve) => (complete = resolve));
        execute.callsFake(async function* (code, token) {
            if (code.includes("_mssql_runtime.initialize")) {
                initializationToken = token;
                started();
                await completion;
                yield {
                    items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_PYTHON_CONNECTED__\n")],
                };
            } else {
                yield { items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_PYTHON_READY__\n")] };
            }
        });
        const connecting = controller.connect();
        const outcome = connecting.then(
            () => undefined,
            (error: Error) => error.message,
        );
        try {
            await initializing;
            await controller.disconnect();
            expect(revoke.calledWith("synthetic-capability")).to.equal(true);
            expect(initializationToken?.isCancellationRequested).to.equal(true);
        } finally {
            complete!();
            await outcome;
        }
        expect(await outcome).to.equal("Canceled");
        expect(
            execute.getCalls().some((call) => call.args[0].includes("_mssql_runtime.disconnect()")),
        ).to.equal(true);
        expect(
            (vscode.window.showInformationMessage as sinon.SinonStub).calledWith(
                PythonNotebooks.connected,
            ),
        ).to.equal(false);
    });

    test("Disconnect while consent is open prevents credential preparation", async () => {
        consent.callsFake(async () => {
            await controller.disconnect();
            return PythonNotebooks.allow;
        });
        await rejects(controller.connect(), "Canceled");
        expect(configuration.called).to.equal(false);
        expect(createSession.called).to.equal(false);
        expect(execute.called).to.equal(false);
    });

    test("Disconnect while credentials are pending prevents session creation", async () => {
        configuration.callsFake(async () => {
            await controller.disconnect();
        });
        await rejects(controller.connect(), "Canceled");
        expect(createSession.called).to.equal(false);
    });

    test("Disconnect during broker creation revokes the returned capability", async () => {
        createSession.callsFake(async () => {
            await controller.disconnect();
            return { brokerUrl: "http://127.0.0.1:1234", capability: "synthetic-capability" };
        });
        await rejects(controller.connect(), "Canceled");
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
        expect(
            execute.getCalls().some((call) => call.args[0].includes("_mssql_runtime.initialize")),
        ).to.equal(false);
    });

    test("does not install dependencies without explicit installation consent", async () => {
        consent.resolves(undefined);
        await rejects(controller.setupDependencies(), "Canceled");
        expect(execute.called).to.equal(false);
    });

    test("allows cancelling kernel selection and rejects a non-Python kernel", async () => {
        getKernel.resolves(undefined);
        await rejects(controller.connect(), "Canceled");
        getKernel.resolves({ ...kernel, language: "r" });
        await rejects(controller.connect(), PythonNotebooks.errors.kernel);
        expect(consent.called).to.equal(false);
    });

    test("surfaces failed dependency installation without creating a credential session", async () => {
        consent.resolves(PythonNotebooks.install);
        execute.callsFake(async function* () {
            yield { items: [vscode.NotebookCellOutputItem.error(new Error("pip failed"))] };
        });
        await rejects(controller.setupDependencies(), PythonNotebooks.errors.initialization);
        expect(
            execute.getCalls().some((call) => call.args[0].includes("'pip', 'install'")),
        ).to.equal(true);
        expect(revoke.called).to.equal(false);
    });

    test("reports missing dependencies before granting credential access", async () => {
        execute.callsFake(async function* () {
            yield {
                items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_DEPENDENCIES_MISSING__\n")],
            };
        });
        await rejects(controller.connect(), PythonNotebooks.errors.dependencies);
        expect(revoke.called).to.equal(false);
    });

    test("revokes and cleans up initialization that fails after connecting", async () => {
        execute.callsFake(async function* (code) {
            if (code.includes("_mssql_runtime.initialize")) {
                yield {
                    items: [vscode.NotebookCellOutputItem.error(new Error("synthetic-secret"))],
                };
            } else {
                yield { items: [vscode.NotebookCellOutputItem.stdout("__MSSQL_PYTHON_READY__\n")] };
            }
        });
        await rejects(controller.connect(), PythonNotebooks.errors.initialization);
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
        expect(
            execute.getCalls().some((call) => call.args[0].includes("_mssql_runtime.disconnect()")),
        ).to.equal(true);
    });

    test("revokes immediately on kernel restart", async () => {
        await controller.connect();
        status.fire("restarting");
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
        expect(revokeIntellisense).to.have.been.called;
    });

    test("requires a separate kernel for a second notebook", async () => {
        await controller.connect();
        document = { ...document, uri: vscode.Uri.file("C:\\other.ipynb") };
        await rejects(controller.connect(), PythonNotebooks.errors.kernelInUse);
    });

    test("cleans up a closed notebook and does not authorize copied metadata", async () => {
        await controller.connect();
        const revoked = new Promise<void>((resolve) => revoke.callsFake(() => resolve()));
        const previous = document;
        document = { ...document, uri: vscode.Uri.file("C:\\copy.ipynb") };
        getKernel.resolves({ ...kernel });
        controller.handleNotebookClosed(previous);
        await controller.handleNotebookOpened(document);
        await revoked;
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
    });

    test("preserves authorization across save only for the same live kernel", async () => {
        await controller.connect();
        const previous = document;
        Object.defineProperty(previous, "isClosed", { value: true });
        document = { ...document, uri: vscode.Uri.file("C:\\saved.ipynb"), isClosed: false };
        controller.handleNotebookClosed(previous);
        await controller.handleNotebookOpened(document);
        expect(revoke.called).to.equal(false);
        await controller.disconnect();
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
    });

    test("cleans up the Python session on disposal", async () => {
        await controller.connect();
        await controller.dispose();
        expect(revoke.calledWith("synthetic-capability")).to.equal(true);
        expect(
            execute.getCalls().some((call) => call.args[0].includes("_mssql_runtime.disconnect()")),
        ).to.equal(true);
    });
});
