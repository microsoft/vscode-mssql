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

function richOutputWithBlocks(
    blocks: Array<Record<string, unknown>>,
    plainFallback = "fallback",
): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([
        vscode.NotebookCellOutputItem.json({ version: 1, blocks }, MIME_MSSQL_RICH),
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

        test("returns a status bar item when a rich output bundles messages with a result set", () => {
            // Mirrors sqlNotebookController.buildRichBatchOutput: when a batch has
            // both messages and a grid, all blocks land in a single rich output.
            const cell = makeCell([
                richOutputWithBlocks([
                    { type: "text", text: "DEBUG #1" },
                    { type: "resultSet", columnInfo: [], rows: [], rowCount: 0 },
                ]),
            ]);
            const item = runProvider(cell) as vscode.NotebookCellStatusBarItem;

            expect(item).to.not.be.undefined;
        });

        test("returns undefined when a rich output contains only a result-set block", () => {
            const cell = makeCell([
                richOutputWithBlocks([
                    { type: "resultSet", columnInfo: [], rows: [], rowCount: 0 },
                ]),
            ]);
            expect(runProvider(cell)).to.be.undefined;
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

        test("extracts message blocks from a rich output that bundles messages with a grid", async () => {
            // Repro for the scenario where a single batch emits both RAISERROR
            // messages and a SELECT result — the controller packs them into one
            // rich output whose text/plain fallback concatenates everything.
            const cell = makeCell([
                richOutputWithBlocks([
                    { type: "text", text: "DEBUG #1" },
                    { type: "text", text: "DEBUG #2" },
                    { type: "resultSet", columnInfo: [], rows: [], rowCount: 0 },
                    { type: "text", text: "Total execution time: 00:00:03.900" },
                ]),
            ]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith(
                `DEBUG #1${os.EOL}DEBUG #2${os.EOL}Total execution time: 00:00:03.900`,
            );
        });

        test("includes error blocks from a rich output and skips the result set", async () => {
            const cell = makeCell([
                richOutputWithBlocks([
                    { type: "error", text: "Msg 208: Invalid object name" },
                    { type: "resultSet", columnInfo: [], rows: [], rowCount: 0 },
                ]),
            ]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledOnceWith(
                "Msg 208: Invalid object name",
            );
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

        test("does nothing when invoked without a cell argument", async () => {
            await capturedHandler(undefined as unknown as vscode.NotebookCell);

            expect(clipboardWriteTextStub).to.not.have.been.called;
            expect(setStatusBarMessageStub).to.not.have.been.called;
        });

        test("preserves large content verbatim (repro for vscode-mssql#21378)", async () => {
            const manyLines = Array.from({ length: 5000 }, (_, i) => `debug message ${i + 1}`);
            const cell = makeCell([textOutput(manyLines.join("\n"))]);
            await capturedHandler(cell);

            expect(clipboardWriteTextStub).to.have.been.calledWithMatch(
                sinon.match(
                    (value: unknown) =>
                        typeof value === "string" &&
                        value.split("\n").length === 5000 &&
                        value.includes("debug message 1") &&
                        value.includes("debug message 5000"),
                    "clipboard payload with 5000 debug lines",
                ),
            );
        });
    });
});
