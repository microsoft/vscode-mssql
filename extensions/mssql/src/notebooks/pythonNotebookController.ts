/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import type { Jupyter, Kernel } from "@vscode/jupyter-extension";
import { sendActionEvent } from "extension-toolkit/vscode";
import ConnectionManager from "../controllers/connectionManager";
import * as Constants from "../constants/constants";
import { PythonNotebooks as Loc } from "../constants/locConstants";
import { Logger } from "../models/logger";
import { ObjectExplorerUtils } from "../objectExplorer/objectExplorerUtils";
import { TreeNodeInfo } from "../objectExplorer/nodes/treeNodeInfo";
import { TelemetryActions, TelemetryViews } from "../sharedInterfaces/telemetry";
import {
    isPythonNotebookReference,
    PythonNotebookConnectionReference,
    PythonNotebookCredentialsProvider,
    PythonNotebookError,
} from "./pythonNotebookCredentials";
import {
    PythonNotebookBootstrap,
    PythonNotebookSessionBroker,
} from "./pythonNotebookSessionBroker";
import { PythonNotebookIntellisense } from "./pythonNotebookIntellisense";
import { projectPythonNotebookSql } from "./pythonNotebookSqlProjection";
import { getPreviewConfigKey, PreviewFeature, previewService } from "../previews/previewService";

export function createPythonNotebookData(
    reference: PythonNotebookConnectionReference,
): vscode.NotebookData {
    const data = new vscode.NotebookData([
        new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, Loc.introduction, "markdown"),
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "pass", "python"),
        new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, Loc.examples, "markdown"),
        new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            "%%tsql --bind df\nSELECT 1 AS value;",
            "python",
        ),
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "df.describe()", "python"),
    ]);
    data.metadata = {
        metadata: {
            kernelspec: { name: "python3", display_name: "Python 3", language: "python" },
            language_info: { name: "python" },
            [Constants.pythonNotebookMetadataKey]: { ...reference },
        },
    };
    return data;
}

export function getPythonNotebookReference(
    document: Pick<vscode.NotebookDocument, "metadata">,
): PythonNotebookConnectionReference | undefined {
    const metadata = document.metadata;
    const value: unknown =
        metadata?.metadata?.[Constants.pythonNotebookMetadataKey] ??
        metadata?.custom?.metadata?.[Constants.pythonNotebookMetadataKey] ??
        metadata?.[Constants.pythonNotebookMetadataKey];
    return isPythonNotebookReference(value) ? value : undefined;
}

interface NotebookSession {
    document: vscode.NotebookDocument;
    kernel: Kernel;
    bootstrap: PythonNotebookBootstrap;
    statusListener: vscode.Disposable;
    intellisense: vscode.Disposable;
    closeTimer?: ReturnType<typeof setTimeout>;
    label: string;
}

interface PendingNotebookConnection {
    source: vscode.CancellationTokenSource;
    bootstrap?: PythonNotebookBootstrap;
}

const readyMarker = "__MSSQL_PYTHON_READY__";
const restartMarker = "__MSSQL_PYTHON_RESTART__";
const connectedMarker = "__MSSQL_PYTHON_CONNECTED__";
const databaseMarker = "__MSSQL_PYTHON_DATABASE__";

export class PythonNotebookController implements vscode.Disposable {
    private readonly log = Logger.forChannelName("MSSQL - Notebooks", "PythonNotebookController");
    private readonly broker: PythonNotebookSessionBroker;
    private readonly intellisense: PythonNotebookIntellisense;
    private readonly disposables: vscode.Disposable[] = [];
    private readonly sessions = new Set<NotebookSession>();
    private readonly connecting = new Map<vscode.NotebookDocument, PendingNotebookConnection>();
    private readonly connectingKernels = new Set<Kernel>();
    private readonly pending = new Set<vscode.CancellationTokenSource>();
    private readonly prompted = new WeakSet<vscode.NotebookDocument>();
    private readonly reconnect = new WeakSet<vscode.NotebookDocument>();
    private readonly connectionStatus = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        97,
    );
    private disposed = false;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly manager: ConnectionManager,
    ) {
        this.connectionStatus.name = Loc.connectionStatusName;
        this.disposables.push(this.connectionStatus);
        this.broker = new PythonNotebookSessionBroker(this.log, () => this.isAllowed());
        this.intellisense = new PythonNotebookIntellisense(this.manager, this.log, () =>
            this.isAllowed(),
        );
        const register = (
            command: string,
            action: TelemetryActions,
            callback: (node?: TreeNodeInfo) => Promise<void>,
        ) => {
            this.disposables.push(
                vscode.commands.registerCommand(command, async (node?: TreeNodeInfo) => {
                    try {
                        await callback(node);
                        sendActionEvent(TelemetryViews.PythonNotebooks, action, {
                            additionalProps: { outcome: "completed" },
                        });
                    } catch (error) {
                        if (error instanceof vscode.CancellationError) {
                            sendActionEvent(TelemetryViews.PythonNotebooks, action, {
                                additionalProps: { outcome: "cancelled" },
                            });
                            return;
                        }
                        const code =
                            error instanceof PythonNotebookError ? error.code : "initialization";
                        this.log.warn(`Python notebook command failed: ${code}.`);
                        sendActionEvent(TelemetryViews.PythonNotebooks, action, {
                            additionalProps: { outcome: "failed", errorCode: code },
                        });
                        await vscode.window.showErrorMessage(Loc.errors[code]);
                    }
                }),
            );
        };
        register(Constants.cmdNotebooksCreatePython, TelemetryActions.CreateNotebook, (node) =>
            this.createFromNode(node),
        );
        register(Constants.cmdNotebooksConnectPython, TelemetryActions.NotebookConnect, () =>
            this.connect(),
        );
        register(Constants.cmdNotebooksDisconnectPython, TelemetryActions.NotebookDisconnect, () =>
            this.disconnect(),
        );
        register(
            Constants.cmdNotebooksSetupPython,
            TelemetryActions.NotebookSetupDependencies,
            () => this.setupDependencies(),
        );
        this.disposables.push(
            vscode.workspace.onDidCloseNotebookDocument((document) => {
                this.handleNotebookClosed(document);
            }),
            vscode.workspace.onDidOpenNotebookDocument((document) => {
                void this.handleNotebookOpened(document);
            }),
            vscode.window.onDidChangeActiveNotebookEditor((editor) => {
                if (editor) void this.handleNotebookOpened(editor.notebook);
                else void this.updateConnectionUi();
            }),
            vscode.workspace.onDidChangeNotebookDocument((event) => {
                if (event.cellChanges.length || event.contentChanges.length || event.metadata) {
                    void this.handleNotebookOpened(event.notebook);
                }
            }),
            vscode.workspace.onDidChangeTextDocument((event) => {
                if (!this.isAllowed()) return;
                const document = vscode.window.activeNotebookEditor?.notebook;
                if (document?.getCells().some((cell) => cell.document === event.document)) {
                    void this.handleNotebookOpened(document);
                }
            }),
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (
                    !event.affectsConfiguration("mssql.enableExperimentalFeatures") &&
                    !event.affectsConfiguration(getPreviewConfigKey(PreviewFeature.PythonNotebooks))
                ) {
                    return;
                }
                if (!this.isAllowed()) {
                    for (const document of this.connecting.keys()) this.cancelConnection(document);
                    for (const source of this.pending) source.cancel();
                    for (const session of [...this.sessions]) void this.release(session, false);
                }
                const document = vscode.window.activeNotebookEditor?.notebook;
                if (document) void this.handleNotebookOpened(document);
                else void this.updateConnectionUi();
            }),
        );
        void this.updateConnectionUi();
        queueMicrotask(() => {
            const document = vscode.window.activeNotebookEditor?.notebook;
            if (document && vscode.workspace.notebookDocuments.includes(document)) {
                void this.handleNotebookOpened(document);
            }
        });
    }

    private isSqlNotebook(document: vscode.NotebookDocument): boolean {
        return (
            document.notebookType === "jupyter-notebook" &&
            !document.isClosed &&
            (!!getPythonNotebookReference(document) ||
                document
                    .getCells()
                    .some(
                        (cell) =>
                            cell.kind === vscode.NotebookCellKind.Code &&
                            cell.document.languageId === "python" &&
                            !!projectPythonNotebookSql(cell.document.getText() + "\n"),
                    ))
        );
    }

    private async updateConnectionUi(): Promise<void> {
        const document = vscode.window.activeNotebookEditor?.notebook;
        const eligible = !!document && this.isAllowed() && this.isSqlNotebook(document);
        const session = [...this.sessions].find((item) => item.document === document);
        await Promise.all([
            vscode.commands.executeCommand(
                "setContext",
                "mssql.pythonNotebookEnabled",
                this.isAllowed(),
            ),
            vscode.commands.executeCommand("setContext", "mssql.pythonNotebook", eligible),
            vscode.commands.executeCommand(
                "setContext",
                "mssql.pythonNotebookConnected",
                eligible && !!session,
            ),
            vscode.commands.executeCommand(
                "setContext",
                "mssql.pythonNotebookConnecting",
                !!document && this.connecting.has(document),
            ),
        ]);
        if (vscode.window.activeNotebookEditor?.notebook !== document) return;
        if (!eligible || this.disposed) {
            this.connectionStatus.hide();
            return;
        }
        this.connectionStatus.text = session
            ? `$(database) ${session.label}`
            : `$(plug) ${Loc.connectSql}`;
        this.connectionStatus.tooltip = session ? Loc.disconnectSql : Loc.connectPrompt;
        this.connectionStatus.command = session
            ? Constants.cmdNotebooksDisconnectPython
            : Constants.cmdNotebooksConnectPython;
        this.connectionStatus.show();
    }

    private async offerConnection(document: vscode.NotebookDocument): Promise<void> {
        if (
            !this.isAllowed() ||
            !this.isSqlNotebook(document) ||
            vscode.window.activeNotebookEditor?.notebook !== document ||
            this.prompted.has(document) ||
            this.connecting.has(document) ||
            [...this.sessions].some((session) => session.document === document)
        ) {
            return;
        }
        this.prompted.add(document);
        const action = this.reconnect.has(document) ? Loc.reconnect : Loc.connect;
        const selected = await vscode.window.showInformationMessage(
            this.reconnect.has(document) ? Loc.reconnectPrompt : Loc.connectPrompt,
            action,
            Loc.notNow,
        );
        if (
            selected !== action ||
            !this.isAllowed() ||
            !this.isSqlNotebook(document) ||
            this.connecting.has(document) ||
            [...this.sessions].some((session) => session.document === document)
        ) {
            return;
        }
        await vscode.window.showNotebookDocument(document);
        if (vscode.window.activeNotebookEditor?.notebook === document) {
            await vscode.commands.executeCommand(Constants.cmdNotebooksConnectPython);
        }
    }

    private async chooseReference(): Promise<PythonNotebookConnectionReference> {
        const choices = await this.manager.connectionStore.getProfilePickListItems();
        const connection = await this.manager.connectionUI.promptForConnection(choices);
        if (!connection) throw new vscode.CancellationError();
        if (!("id" in connection) || typeof connection.id !== "string" || !connection.id) {
            throw new PythonNotebookError("connectionMissing");
        }
        return { version: 1, connectionId: connection.id, database: connection.database };
    }

    private async saveReference(
        document: vscode.NotebookDocument,
        reference: PythonNotebookConnectionReference,
    ): Promise<void> {
        const metadata = document.metadata;
        const updated = metadata.custom?.metadata
            ? {
                  ...metadata,
                  custom: {
                      ...metadata.custom,
                      metadata: {
                          ...metadata.custom.metadata,
                          [Constants.pythonNotebookMetadataKey]: reference,
                      },
                  },
              }
            : {
                  ...metadata,
                  metadata: {
                      ...metadata.metadata,
                      [Constants.pythonNotebookMetadataKey]: reference,
                  },
              };
        const edit = new vscode.WorkspaceEdit();
        edit.set(document.uri, [vscode.NotebookEdit.updateNotebookMetadata(updated)]);
        if (!(await vscode.workspace.applyEdit(edit))) {
            throw new PythonNotebookError("initialization");
        }
    }

    private isAllowed(): boolean {
        return (
            !this.disposed &&
            vscode.workspace.isTrusted &&
            previewService.isFeatureEnabled(PreviewFeature.PythonNotebooks) &&
            !vscode.workspace.workspaceFolders?.some(
                (folder) => !["file", "vscode-remote"].includes(folder.uri.scheme),
            )
        );
    }

    private guard(): void {
        if (this.disposed || !previewService.isFeatureEnabled(PreviewFeature.PythonNotebooks)) {
            throw new PythonNotebookError("disabled");
        }
        if (!vscode.workspace.isTrusted) throw new PythonNotebookError("trust");
        if (!this.isAllowed()) throw new PythonNotebookError("virtual");
    }

    private async createFromNode(node?: TreeNodeInfo): Promise<void> {
        this.guard();
        if (node?.connectionProfile?.id) {
            await this.createNotebook({
                version: 1,
                connectionId: node.connectionProfile.id,
                database:
                    ObjectExplorerUtils.getDatabaseName(node) || node.connectionProfile.database,
            });
        } else {
            await this.createNotebook(await this.chooseReference());
        }
    }

    public async createNotebook(reference: PythonNotebookConnectionReference): Promise<void> {
        this.guard();
        if (!isPythonNotebookReference(reference))
            throw new PythonNotebookError("connectionMissing");
        const document = await vscode.workspace.openNotebookDocument(
            "jupyter-notebook",
            createPythonNotebookData(reference),
        );
        await vscode.window.showNotebookDocument(document);
    }

    private document(): vscode.NotebookDocument {
        this.guard();
        const document = vscode.window.activeNotebookEditor?.notebook;
        if (!document || document.notebookType !== "jupyter-notebook") {
            throw new PythonNotebookError("notebook");
        }
        return document;
    }

    private async jupyter(): Promise<Jupyter> {
        const extension = vscode.extensions.getExtension<Jupyter>("ms-toolsai.jupyter");
        const python = vscode.extensions.getExtension("ms-python.python");
        if (!extension || !python) {
            const selected = await vscode.window.showWarningMessage(
                Loc.errors.extension,
                Loc.installExtensions,
            );
            if (selected === Loc.installExtensions) {
                await vscode.commands.executeCommand("extension.open", "ms-toolsai.jupyter");
            }
            throw new PythonNotebookError("extension");
        }
        return extension.activate();
    }

    private async kernel(document: vscode.NotebookDocument): Promise<Kernel> {
        const kernel = await (await this.jupyter()).kernels.getKernel(document.uri);
        if (!kernel || kernel.language !== "python") throw new PythonNotebookError("kernel");
        return kernel;
    }

    private async startKernel(
        document: vscode.NotebookDocument,
        token: vscode.CancellationToken,
    ): Promise<Kernel> {
        const existing = await (await this.jupyter()).kernels.getKernel(document.uri);
        if (existing) {
            if (existing.language !== "python") throw new PythonNotebookError("kernel");
            return existing;
        }
        const notebookEditor = await vscode.window.showNotebookDocument(document);
        const selected = await vscode.commands.executeCommand<boolean>("notebook.selectKernel", {
            notebookEditor,
        });
        if (selected === false || document.isClosed || token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        let index = document
            .getCells()
            .findIndex(
                (cell) =>
                    cell.kind === vscode.NotebookCellKind.Code &&
                    cell.document.languageId === "python" &&
                    cell.document.getText().trim() === "pass",
            );
        if (index < 0) {
            const edit = new vscode.WorkspaceEdit();
            edit.set(document.uri, [
                vscode.NotebookEdit.insertCells(0, [
                    new vscode.NotebookCellData(vscode.NotebookCellKind.Code, "pass", "python"),
                ]),
            ]);
            if (!(await vscode.workspace.applyEdit(edit))) {
                throw new PythonNotebookError("initialization");
            }
            index = 0;
        }
        const cell = document.cellAt(index);
        if (cell.document.languageId !== "python" || cell.document.getText().trim() !== "pass") {
            throw new PythonNotebookError("kernel");
        }
        const listeners: vscode.Disposable[] = [];
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            await new Promise<void>((resolve, reject) => {
                timer = setTimeout(() => reject(new PythonNotebookError("kernel")), 120000);
                listeners.push(
                    vscode.workspace.onDidChangeNotebookDocument((event) => {
                        const result = event.cellChanges.find(
                            (change) => change.cell === cell && change.executionSummary,
                        )?.executionSummary;
                        if (result?.success === true) resolve();
                        else if (result?.success === false) {
                            reject(new PythonNotebookError("kernel"));
                        }
                    }),
                    token.onCancellationRequested(() => reject(new vscode.CancellationError())),
                );
                void vscode.commands
                    .executeCommand("notebook.cell.execute", {
                        document: document.uri,
                        ranges: [{ start: index, end: index + 1 }],
                    })
                    .then(undefined, reject);
            });
        } finally {
            clearTimeout(timer);
            listeners.forEach((listener) => listener.dispose());
        }
        return this.kernel(document);
    }

    private async execute(
        kernel: Kernel,
        code: string,
        token: vscode.CancellationToken,
    ): Promise<string> {
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        let text = "";
        for await (const output of kernel.executeCode(code, token)) {
            for (const item of output.items) {
                if (item.mime === "application/vnd.code.notebook.error") {
                    throw new PythonNotebookError("initialization");
                }
                if (item.mime === vscode.NotebookCellOutputItem.stdout("").mime) {
                    text += new TextDecoder().decode(item.data);
                    if (text.length > 65536) throw new PythonNotebookError("initialization");
                }
            }
        }
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        return text;
    }

    private async withKernelProgress(
        title: string,
        source: vscode.CancellationTokenSource,
        operation: (token: vscode.CancellationToken) => Promise<void>,
    ): Promise<void> {
        await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification, title, cancellable: true },
            async (_progress, userToken) => {
                const listener = userToken.onCancellationRequested(() => source.cancel());
                try {
                    await operation(source.token);
                } finally {
                    listener.dispose();
                }
            },
        );
    }

    private async dependencyStatus(
        kernel: Kernel,
        token: vscode.CancellationToken,
    ): Promise<string> {
        const [source, requirements] = await Promise.all([
            vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(
                    this.context.extensionUri,
                    "python",
                    "mssql_notebook_dependencies.py",
                ),
            ),
            vscode.workspace.fs.readFile(
                vscode.Uri.joinPath(this.context.extensionUri, "python", "requirements.txt"),
            ),
        ]);
        return this.execute(
            kernel,
            [
                "import base64 as _mssql_b64, types as _mssql_types",
                "_mssql_dependencies = _mssql_types.ModuleType('_vscode_mssql_dependencies')",
                `exec(compile(_mssql_b64.b64decode('${Buffer.from(source).toString("base64")}'), '<mssql-dependencies>', 'exec'), _mssql_dependencies.__dict__)`,
                `_mssql_ready = _mssql_dependencies.check_dependencies(_mssql_b64.b64decode('${Buffer.from(requirements).toString("base64")}').decode('utf-8'))`,
                `print({'ready': '${readyMarker}', 'restart': '${restartMarker}', 'missing': '__MSSQL_DEPENDENCIES_MISSING__'}[_mssql_ready])`,
            ].join("\n"),
            token,
        );
    }

    private async restartForDependencies(
        document: vscode.NotebookDocument,
        token: vscode.CancellationToken,
    ): Promise<never> {
        const selected = await vscode.window.showWarningMessage(
            Loc.restartConsent,
            { modal: true },
            Loc.restartKernel,
        );
        if (selected !== Loc.restartKernel || token.isCancellationRequested || document.isClosed) {
            throw new vscode.CancellationError();
        }
        this.guard();
        await vscode.window.showNotebookDocument(document);
        if (token.isCancellationRequested) throw new vscode.CancellationError();
        await vscode.commands.executeCommand("notebook.restartKernel", document.uri);
        this.reconnect.add(document);
        this.prompted.delete(document);
        if (!this.connecting.has(document)) void this.handleNotebookOpened(document);
        throw new vscode.CancellationError();
    }

    public async connect(): Promise<void> {
        const document = this.document();
        if (this.connecting.has(document)) throw new PythonNotebookError("initialization");
        const connection: PendingNotebookConnection = {
            source: new vscode.CancellationTokenSource(),
        };
        this.connecting.set(document, connection);
        this.pending.add(connection.source);
        const checkCancellation = () => {
            if (connection.source.token.isCancellationRequested) {
                throw new vscode.CancellationError();
            }
        };
        let kernel: Kernel | undefined;
        let ownsKernel = false;
        let initializing = false;
        try {
            await this.updateConnectionUi();
            const savedReference = getPythonNotebookReference(document);
            const reference = savedReference ?? (await this.chooseReference());
            checkCancellation();
            this.guard();
            kernel = await this.startKernel(document, connection.source.token);
            checkCancellation();
            await this.updateConnectionUi();
            if (this.connectingKernels.has(kernel)) throw new PythonNotebookError("kernelInUse");
            this.connectingKernels.add(kernel);
            ownsKernel = true;
            const selectedKernel = kernel;
            if (
                [...this.sessions].some(
                    (session) => session.kernel === kernel && session.document !== document,
                )
            ) {
                throw new PythonNotebookError("kernelInUse");
            }
            const existing = [...this.sessions].find((session) => session.document === document);
            if (existing) await this.release(existing, true);
            checkCancellation();
            const profile = (
                await this.manager.connectionStore.connectionConfig.getConnections()
            ).find((item) => item.id === reference.connectionId);
            if (!profile) throw new PythonNotebookError("connectionMissing");
            checkCancellation();
            const provider = new PythonNotebookCredentialsProvider(
                this.manager,
                profile,
                reference,
            );
            const allowed = await vscode.window.showWarningMessage(
                Loc.consent(
                    profile.server,
                    (reference.database ?? profile.database) || Loc.defaultDatabase,
                ),
                { modal: true },
                Loc.allow,
            );
            if (allowed !== Loc.allow) throw new vscode.CancellationError();
            checkCancellation();
            await this.withKernelProgress(Loc.working, connection.source, async (token) => {
                const status = (await this.dependencyStatus(selectedKernel, token)).split(/\r?\n/);
                if (status.includes(restartMarker)) {
                    await this.restartForDependencies(document, token);
                }
                if (!status.includes(readyMarker)) {
                    const selected = await vscode.window.showWarningMessage(
                        Loc.errors.dependencies,
                        Loc.installAndConnect,
                        Loc.notNow,
                    );
                    if (selected !== Loc.installAndConnect) {
                        throw new PythonNotebookError("dependencies");
                    }
                    await this.setupDependencies(document, connection.source.token);
                }
                this.guard();
                if (document.isClosed || (await this.kernel(document)) !== kernel) {
                    throw new PythonNotebookError("kernel");
                }
                checkCancellation();
                await provider.getConfiguration(reference);
                checkCancellation();
                if (!savedReference) {
                    await this.saveReference(document, reference);
                    checkCancellation();
                }
                connection.bootstrap = await this.broker.createSession(provider, reference);
                checkCancellation();
                const source = await vscode.workspace.fs.readFile(
                    vscode.Uri.joinPath(this.context.extensionUri, "python", "mssql_notebook.py"),
                );
                const payload = Buffer.from(
                    JSON.stringify({
                        ...connection.bootstrap,
                        messages: Loc.runtimeMessages,
                    }),
                ).toString("base64");
                initializing = true;
                const result = await this.execute(
                    selectedKernel,
                    [
                        "import base64 as _mssql_b64, types as _mssql_types, json as _mssql_json",
                        "_mssql_runtime = _mssql_types.ModuleType('_vscode_mssql_notebook')",
                        `exec(compile(_mssql_b64.b64decode('${Buffer.from(source).toString("base64")}'), '<mssql-notebook>', 'exec'), _mssql_runtime.__dict__)`,
                        `_mssql_bootstrap = _mssql_json.loads(_mssql_b64.b64decode('${payload}'))`,
                        "try:",
                        "    _mssql_session = _mssql_runtime.initialize(_mssql_bootstrap['brokerUrl'], _mssql_bootstrap['capability'], _mssql_bootstrap['messages'])",
                        `    print('${databaseMarker}' + _mssql_json.dumps(_mssql_session.query('SELECT DB_NAME() AS [database]').iloc[0, 0]))`,
                        "finally:",
                        "    _mssql_bootstrap.clear()",
                        "    del _mssql_bootstrap",
                        "    globals().pop('_mssql_session', None)",
                        `print('${connectedMarker}')`,
                    ].join("\n"),
                    token,
                );
                if (!result.split(/\r?\n/).includes(connectedMarker)) {
                    throw new PythonNotebookError("initialization");
                }
                const databaseRecord = result
                    .split(/\r?\n/)
                    .find((line) => line.startsWith(databaseMarker));
                let actualDatabase: unknown;
                try {
                    actualDatabase =
                        databaseRecord && JSON.parse(databaseRecord.slice(databaseMarker.length));
                } catch {
                    throw new PythonNotebookError("initialization");
                }
                if (typeof actualDatabase !== "string" || !actualDatabase) {
                    throw new PythonNotebookError("initialization");
                }
                this.guard();
                if (document.isClosed || (await this.kernel(document)) !== kernel) {
                    throw new PythonNotebookError("kernel");
                }
                checkCancellation();
                const session: NotebookSession = {
                    document,
                    kernel: selectedKernel,
                    bootstrap: connection.bootstrap,
                    intellisense: this.intellisense.authorize(
                        document,
                        provider,
                        reference,
                        actualDatabase,
                    ),
                    statusListener: selectedKernel.onDidChangeStatus((status) => {
                        if (
                            ["dead", "terminating", "restarting", "autorestarting"].includes(status)
                        ) {
                            this.forget(session);
                            this.reconnect.add(session.document);
                            this.prompted.delete(session.document);
                            void this.handleNotebookOpened(session.document);
                        }
                    }),
                    label: Loc.connectionStatus(profile.server, actualDatabase),
                };
                this.sessions.add(session);
                connection.bootstrap = undefined;
            });
            checkCancellation();
            this.prompted.add(document);
            this.reconnect.delete(document);
            await this.updateConnectionUi();
            void vscode.window.showInformationMessage(Loc.connected);
        } finally {
            if (connection.bootstrap) this.broker.revoke(connection.bootstrap.capability);
            if (connection.bootstrap && initializing && kernel)
                await this.cleanupKernel(kernel, false);
            if (ownsKernel) this.connectingKernels.delete(kernel);
            this.connecting.delete(document);
            this.pending.delete(connection.source);
            connection.source.dispose();
            await this.updateConnectionUi();
            if (this.reconnect.has(document)) void this.handleNotebookOpened(document);
        }
    }

    public async setupDependencies(
        document = this.document(),
        parentToken?: vscode.CancellationToken,
    ): Promise<void> {
        this.guard();
        const kernel = await this.kernel(document);
        const selected = await vscode.window.showWarningMessage(
            Loc.installConsent,
            { modal: true },
            Loc.install,
        );
        if (selected !== Loc.install) throw new vscode.CancellationError();
        if (parentToken?.isCancellationRequested) throw new vscode.CancellationError();
        const source = new vscode.CancellationTokenSource();
        const cancellation = parentToken?.onCancellationRequested(() => source.cancel());
        this.pending.add(source);
        try {
            for (const session of [...this.sessions]) {
                if (session.kernel === kernel) await this.release(session, true);
            }
            await this.withKernelProgress(Loc.setup, source, async (token) => {
                this.guard();
                const requirements = await vscode.workspace.fs.readFile(
                    vscode.Uri.joinPath(this.context.extensionUri, "python", "requirements.txt"),
                );
                await this.execute(
                    kernel,
                    [
                        "import sys as _mssql_sys, subprocess as _mssql_subprocess, base64 as _mssql_b64",
                        "if _mssql_sys.version_info < (3, 10): raise RuntimeError('Python 3.10+')",
                        "_mssql_sys._vscode_mssql_restart_required = True",
                        `_mssql_requirements = _mssql_b64.b64decode('${Buffer.from(requirements).toString("base64")}').decode('utf-8').splitlines()`,
                        "_mssql_subprocess.run([_mssql_sys.executable, '-m', 'pip', 'install', *[r.strip() for r in _mssql_requirements if r.strip() and not r.lstrip().startswith('#')]], check=True, stdout=_mssql_subprocess.PIPE, stderr=_mssql_subprocess.STDOUT)",
                    ].join("\n"),
                    token,
                );
                const status = (await this.dependencyStatus(kernel, token)).split(/\r?\n/);
                if (!status.includes(readyMarker) && !status.includes(restartMarker)) {
                    throw new PythonNotebookError("dependencies");
                }
                // pip may also replace native/transitive modules already loaded by IPython.
                await this.restartForDependencies(document, token);
            });
        } finally {
            cancellation?.dispose();
            this.pending.delete(source);
            source.dispose();
        }
    }

    private forget(session: NotebookSession): void {
        session.intellisense.dispose();
        this.broker.revoke(session.bootstrap.capability);
        this.sessions.delete(session);
        session.statusListener.dispose();
        if (session.closeTimer) clearTimeout(session.closeTimer);
    }

    private async release(session: NotebookSession, notify: boolean): Promise<void> {
        this.forget(session);
        await this.cleanupKernel(session.kernel, notify);
        await this.updateConnectionUi();
    }

    private async cleanupKernel(kernel: Kernel, notify: boolean): Promise<void> {
        const source = new vscode.CancellationTokenSource();
        const timer = setTimeout(() => source.cancel(), 10000);
        try {
            await this.execute(
                kernel,
                "if '_mssql_runtime' in globals(): _mssql_runtime.disconnect()",
                source.token,
            );
        } catch {
            this.log.warn(
                "Python notebook credential access revoked; kernel cleanup was not confirmed.",
            );
            if (notify) throw new PythonNotebookError("cleanup");
        } finally {
            clearTimeout(timer);
            source.dispose();
        }
    }

    private cancelConnection(document: vscode.NotebookDocument): void {
        const connection = this.connecting.get(document);
        if (!connection) return;
        connection.source.cancel();
        if (connection.bootstrap) this.broker.revoke(connection.bootstrap.capability);
    }

    public async disconnect(): Promise<void> {
        const document = this.document();
        this.prompted.add(document);
        this.cancelConnection(document);
        for (const session of [...this.sessions]) {
            if (session.document === document) await this.release(session, true);
        }
        await vscode.window.showInformationMessage(Loc.disconnected);
        await this.updateConnectionUi();
    }

    public handleNotebookClosed(document: vscode.NotebookDocument): void {
        this.cancelConnection(document);
        this.intellisense.suspend(document);
        for (const session of this.sessions) {
            if (session.document === document) {
                // Saving replaces the document; only the same live kernel can adopt the session.
                session.closeTimer = setTimeout(() => {
                    void this.release(session, false);
                }, 1000);
            }
        }
    }

    public async handleNotebookOpened(document: vscode.NotebookDocument): Promise<void> {
        if (!this.sessions.size || !getPythonNotebookReference(document)) {
            await this.updateConnectionUi();
            await this.offerConnection(document);
            return;
        }
        try {
            const kernel = await (await this.jupyter()).kernels.getKernel(document.uri);
            for (const session of [...this.sessions]) {
                if (session.document === document && kernel !== session.kernel) {
                    await this.release(session, false);
                } else if (session.document.isClosed && kernel === session.kernel) {
                    const previous = getPythonNotebookReference(session.document);
                    const next = getPythonNotebookReference(document);
                    if (
                        previous?.connectionId !== next?.connectionId ||
                        previous?.database !== next?.database
                    ) {
                        continue;
                    }
                    if (session.closeTimer) clearTimeout(session.closeTimer);
                    session.closeTimer = undefined;
                    this.intellisense.adopt(session.document, document);
                    session.document = document;
                }
            }
        } catch {
            this.log.warn(
                "Python notebook kernel lifecycle check failed; credential access revoked.",
            );
            for (const session of [...this.sessions]) {
                if (session.document === document || session.document.isClosed)
                    this.forget(session);
            }
        }
        await this.updateConnectionUi();
        await this.offerConnection(document);
    }

    public async dispose(): Promise<void> {
        this.disposed = true;
        this.intellisense.dispose();
        this.disposables.forEach((item) => item.dispose());
        for (const document of this.connecting.keys()) this.cancelConnection(document);
        for (const source of this.pending) source.cancel();
        const cleanup = [...this.sessions].map((session) => this.release(session, false));
        await this.broker.dispose();
        await Promise.all(cleanup);
    }
}
