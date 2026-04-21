/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from "os";
import * as sinon from "sinon";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import { expect } from "chai";
import * as vscode from "vscode";

chai.use(sinonChai);
import * as Constants from "../../../src/constants/constants";
import * as LocalizedConstants from "../../../src/constants/locConstants";
import { registerNotebookCopyOutput } from "../../../src/notebooks/notebookCopyOutputProvider";

const MIME_MSSQL_RICH = "application/vnd.mssql.query-result";

function textOutput(text: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.text(text, "text/plain")]);
}

function stderrOutput(text: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.stderr(text)]);
}

function richOutput(plainFallback: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.json({ version: 1, blocks: [] }, MIME_MSSQL_RICH),
        vscode.NotebookCellOutputItem.text(plainFallback, "text/plain"),
    ]);
}

function emptyOutput(): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([]);
}

function makeCell(outputs: vscode.NotebookCellOutput[], languageId = "sql"): vscode.NotebookCell {
    return {
        document: { languageId },
        outputs,
    } as unknown as vscode.NotebookCell;
}

suite("registerNotebookCopyOutput", () => {
    let sandbox: sinon.SinonSandbox;
    let context: { subscriptions: vscode.Disposable[] };
    let capturedHandler: (cell: vscode.NotebookCell) => Promise<void>;
    let capturedProvider: vscode.NotebookCellStatusBarItemProvider;
    let clipboardWriteTextStub: sinon.SinonStub;
    let setStatusBarMessageStub: sinon.SinonStub;
    let registerCommandStub: sinon.SinonStub;
    let registerProviderStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        context = { subscriptions: [] };

        registerCommandStub = sandbox
            .stub(vscode.commands, "registerCommand")
            .callsFake((_cmd: string, handler: (...args: unknown[]) => unknown) => {
                capturedHandler = handler as (cell: vscode.NotebookCell) => Promise<void>;
                return { dispose: () => {} };
            });

        registerProviderStub = sandbox
            .stub(vscode.notebooks, "registerNotebookCellStatusBarItemProvider")
            .callsFake((_type: string, provider: vscode.NotebookCellStatusBarItemProvider) => {
                capturedProvider = provider;
                return { dispose: () => {} };
            });

        clipboardWriteTextStub = sandbox.stub().resolves();
        sandbox.stub(vscode.env, "clipboard").value({ writeText: clipboardWriteTextStub });
        setStatusBarMessageStub = sandbox
            .stub(vscode.window, "setStatusBarMessage")
            .returns({ dispose: () => {} } as vscode.Disposable);

        registerNotebookCopyOutput(context as unknown as vscode.ExtensionContext);
    });

    teardown(() => {
        sandbox.restore();
    });

    function runProvider(
        cell: vscode.NotebookCell,
    ): vscode.NotebookCellStatusBarItem | vscode.NotebookCellStatusBarItem[] | undefined {
        return capturedProvider.provideCellStatusBarItems(cell, {} as vscode.CancellationToken) as
            | vscode.NotebookCellStatusBarItem
            | vscode.NotebookCellStatusBarItem[]
            | undefined;
    }

    suite("registration", () => {
        test("registers the copy command", () => {
            expect(registerCommandStub).to.have.been.calledOnceWith(
                Constants.cmdNotebooksCopyCellOutput,
            );
        });

        test("registers the status bar provider for jupyter-notebook", () => {
            expect(registerProviderStub).to.have.been.calledOnceWith("jupyter-notebook");
        });

        test("pushes both disposables onto the context subscriptions", () => {
            expect(context.subscriptions).to.have.length(2);
        });
    });

    suite("provideCellStatusBarItems", () => {
        test("returns undefined for non-SQL cells", () => {
            const cell = makeCell([textOutput("hi")], "python");
            expect(runProvider(cell)).to.be.undefined;
        });

        test("returns undefined when the cell has no outputs", () => {
            const cell = makeCell([]);
            expect(runProvider(cell)).to.be.undefined;
        });

        test("returns undefined for outputs with no items", () => {
            const cell = makeCell([emptyOutput()]);
            expect(runProvider(cell)).to.be.undefined;
        });

        test("returns undefined when only rich result-set output is present", () => {
            const cell = makeCell([richOutput("header\n1\n2\n")]);
            expect(runProvider(cell)).to.be.undefined;
        });

        test("returns a status bar item for text/plain output", () => {
            const cell = makeCell([textOutput("PRINT message")]);
            const item = runProvider(cell) as vscode.NotebookCellStatusBarItem;

            expect(item).to.not.be.undefined;
            expect(item.text).to.equal(`$(copy) ${LocalizedConstants.Notebooks.copyMessages}`);
            expect(item.alignment).to.equal(vscode.NotebookCellStatusBarAlignment.Right);
            expect(item.tooltip).to.equal(LocalizedConstants.Notebooks.copyMessagesTooltip);
        });

        test("returns a status bar item for stderr output", () => {
            const cell = makeCell([stderrOutput("ERROR: boom")]);
            const item = runProvider(cell) as vscode.NotebookCellStatusBarItem;

            expect(item).to.not.be.undefined;
        });

        test("returns a status bar item when a rich output coexists with plain text", () => {
            const cell = makeCell([richOutput("table"), textOutput("PRINT after")]);
            const item = runProvider(cell) as vscode.NotebookCellStatusBarItem;

            expect(item).to.not.be.undefined;
        });

        test("item invokes the copy command with the cell as argument", () => {
            const cell = makeCell([textOutput("hi")]);
            const item = runProvider(cell) as vscode.NotebookCellStatusBarItem;

            const command = item.command as vscode.Command;
            expect(command.command).to.equal(Constants.cmdNotebooksCopyCellOutput);
            expect(command.arguments).to.deep.equal([cell]);
        });
    });

    suite("copy command handler", () => {
        test("copies text/plain output to the clipboard", async () => {
            const cell = makeCell([textOutput("hello world")]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("hello world");
        });

        test("copies stderr output to the clipboard", async () => {
            const cell = makeCell([stderrOutput("ERROR: failure")]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("ERROR: failure");
        });

        test("joins multiple copyable outputs with os.EOL", async () => {
            const cell = makeCell([
                textOutput("first"),
                stderrOutput("second"),
                textOutput("third"),
            ]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith(
                `first${os.EOL}second${os.EOL}third`,
            );
        });

        test("skips rich result-set outputs and copies only text-only outputs", async () => {
            const cell = makeCell([
                richOutput("tabular fallback text"),
                textOutput("PRINT after grid"),
            ]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith("PRINT after grid");
        });

        test("shows the confirmation status bar message after a successful copy", async () => {
            const cell = makeCell([textOutput("hi")]);
            await capturedHandler(cell);

            expect(setStatusBarMessageStub).to.have.been.calledOnceWith(
                LocalizedConstants.Notebooks.copiedMessages,
                2000,
            );
        });

        test("does nothing when the cell has no copyable output", async () => {
            const cell = makeCell([richOutput("grid only")]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.not.have.been.called;
            expect(setStatusBarMessageStub).to.not.have.been.called;
        });

        test("does nothing when the cell has no outputs at all", async () => {
            const cell = makeCell([]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.not.have.been.called;
            expect(setStatusBarMessageStub).to.not.have.been.called;
        });

        test("preserves large content verbatim (repro for vscode-mssql#21378)", async () => {
            const manyLines = Array.from({ length: 5000 }, (_, i) => `debug message ${i + 1}`);
            const cell = makeCell([textOutput(manyLines.join("\n"))]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnce;
            const copied = clipboardWriteTextStub.firstCall.args[0] as string;
            expect(copied.split("\n")).to.have.length(5000);
            expect(copied).to.include("debug message 1");
            expect(copied).to.include("debug message 5000");
        });
    });
});
