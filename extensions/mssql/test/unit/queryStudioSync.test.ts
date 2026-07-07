/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Query Studio M0 core: text-sync state machine (versions, echo suppression,
 * hash-mismatch resync valve, stale-base rejection, CRLF preservation) and
 * the one-model-per-URI registry (doc 04 §§4.2, 8; the M0 gate).
 */

import { expect } from "chai";
import { applyEdits, TextSyncEngine, textHash } from "../../src/queryStudio/textSync";
import { QueryStudioDocumentRegistry } from "../../src/queryStudio/queryStudioDocumentRegistry";
import { QsTextEdit } from "../../src/sharedInterfaces/queryStudio";

function webviewGroup(
    engine: TextSyncEngine,
    edits: QsTextEdit[],
    groupId = "g1",
): { edits: Parameters<TextSyncEngine["applyWebviewEdits"]>[0]; newText: string } {
    const newText = applyEdits(engine.currentText, edits);
    return {
        edits: {
            baseHostVersion: engine.hostVersion,
            editGroupId: groupId,
            edits,
            textHashAfter: textHash(newText),
        },
        newText,
    };
}

suite("Query Studio text sync", () => {
    test("single-cursor typing round trip with echo suppression", () => {
        const engine = new TextSyncEngine("select 1");
        const group = webviewGroup(engine, [{ start: 8, end: 8, text: "0" }]);
        const outcome = engine.applyWebviewEdits(group.edits);
        expect(outcome.applied).to.equal(true);
        expect(outcome.newText).to.equal("select 10");
        expect(engine.hostVersion).to.equal(2);
        // The TextDocument change fires back — recognized as OUR echo.
        const echo = engine.onHostTextChanged("select 10", [], "hostEdit");
        expect(echo.remote?.reason).to.equal("echo");
        expect(echo.remote?.echoOfEditGroupId).to.equal("g1");
        expect(echo.remote?.edits).to.deep.equal([]);
        expect(engine.resyncCount).to.equal(0);
    });

    test("multi-cursor edit group applies all edits atomically", () => {
        const engine = new TextSyncEngine("aaa bbb aaa");
        // Two cursors replacing both 'aaa' occurrences (descending-safe).
        const group = webviewGroup(engine, [
            { start: 0, end: 3, text: "xxx" },
            { start: 8, end: 11, text: "xxx" },
        ]);
        const outcome = engine.applyWebviewEdits(group.edits);
        expect(outcome.applied).to.equal(true);
        expect(outcome.newText).to.equal("xxx bbb xxx");
    });

    test("paste large text and CRLF preservation", () => {
        const engine = new TextSyncEngine("line1\r\nline2");
        const paste = "big\r\ntext\r\n".repeat(5000);
        const group = webviewGroup(engine, [{ start: 5, end: 5, text: paste }]);
        const outcome = engine.applyWebviewEdits(group.edits);
        expect(outcome.applied).to.equal(true);
        expect(outcome.newText!.includes("\r\n")).to.equal(true);
        expect(outcome.newText!.startsWith("line1big\r\n")).to.equal(true);
    });

    test("stale base version is rejected without resync (webview reconciles)", () => {
        const engine = new TextSyncEngine("select 1");
        // Host-side change lands first (e.g. format-on-save).
        engine.onHostTextChanged("SELECT 1", [{ start: 0, end: 8, text: "SELECT 1" }], "external");
        const stale = engine.applyWebviewEdits({
            baseHostVersion: 1, // engine is now at 2
            editGroupId: "g-stale",
            edits: [{ start: 8, end: 8, text: "0" }],
            textHashAfter: textHash("select 10"),
        });
        expect(stale.applied).to.equal(false);
        expect(stale.resyncNeeded).to.equal(false);
        expect(stale.reason).to.include("stale base");
        expect(engine.currentText).to.equal("SELECT 1");
    });

    test("hash mismatch fires the resync valve and counts it", () => {
        const engine = new TextSyncEngine("select 1");
        const outcome = engine.applyWebviewEdits({
            baseHostVersion: 1,
            editGroupId: "g-bad",
            edits: [{ start: 8, end: 8, text: "0" }],
            textHashAfter: "deadbeef", // wrong on purpose
        });
        expect(outcome.applied).to.equal(false);
        expect(outcome.resyncNeeded).to.equal(true);
        expect(engine.resyncCount).to.equal(1);
        const resync = engine.resync("hash mismatch");
        expect(resync.text).to.equal("select 1");
        expect(resync.textHash).to.equal(textHash("select 1"));
    });

    test("out-of-bounds edit is rejected with resync, text unharmed", () => {
        const engine = new TextSyncEngine("short");
        const outcome = engine.applyWebviewEdits({
            baseHostVersion: 1,
            editGroupId: "g-oob",
            edits: [{ start: 2, end: 99, text: "x" }],
            textHashAfter: "00000000",
        });
        expect(outcome.applied).to.equal(false);
        expect(outcome.resyncNeeded).to.equal(true);
        expect(engine.currentText).to.equal("short");
    });

    test("undo after host edit: external undo flows as a remote change", () => {
        const engine = new TextSyncEngine("v1");
        engine.onHostTextChanged("v2", [{ start: 1, end: 2, text: "2" }], "hostEdit");
        const undo = engine.onHostTextChanged("v1", [{ start: 1, end: 2, text: "1" }], "undo");
        expect(undo.remote?.reason).to.equal("undo");
        expect(undo.remote?.textHash).to.equal(textHash("v1"));
        expect(engine.hostVersion).to.equal(3); // every change bumps
    });

    test("IME-style compose: single final group, no broken intermediates", () => {
        const engine = new TextSyncEngine("名前");
        // Composition commits once as one group (the webview coalesces).
        const group = webviewGroup(engine, [{ start: 2, end: 2, text: "です" }]);
        const outcome = engine.applyWebviewEdits(group.edits);
        expect(outcome.applied).to.equal(true);
        expect(outcome.newText).to.equal("名前です");
    });

    test("webview hash verification detects silent divergence", () => {
        const engine = new TextSyncEngine("same");
        expect(engine.verifyWebviewHash(textHash("same"))).to.equal(true);
        expect(engine.verifyWebviewHash(textHash("different"))).to.equal(false);
        expect(engine.resyncCount).to.equal(1);
    });

    test("applyEdits handles adjacent and replacing edits deterministically", () => {
        expect(applyEdits("abcdef", [{ start: 0, end: 3, text: "X" }])).to.equal("Xdef");
        expect(
            applyEdits("abcdef", [
                { start: 0, end: 2, text: "12" },
                { start: 4, end: 6, text: "56" },
            ]),
        ).to.equal("12cd56");
        expect(applyEdits("", [{ start: 0, end: 0, text: "new" }])).to.equal("new");
    });

    test("stale-base rejection reports current version and no resync (webview must adopt)", () => {
        // The missed-init deadlock (tested end-to-end via adopt below): the
        // webview thinks the base is 0 while the host starts at 1. The
        // rejection returns the real host version so the webview can heal.
        const engine = new TextSyncEngine("");
        const outcome = engine.applyWebviewEdits({
            baseHostVersion: 0,
            editGroupId: "g1",
            edits: [{ start: 0, end: 0, text: "s" }],
            textHashAfter: textHash("s"),
        });
        expect(outcome.applied).to.equal(false);
        expect(outcome.resyncNeeded).to.equal(false);
        expect(outcome.hostVersion).to.equal(1);
    });

    test("adopt converges the host to the webview text and suppresses its echo", () => {
        const engine = new TextSyncEngine("");
        const typed = ["select *", "from sys.objects"].join("\n");
        const adopted = engine.adopt(typed, "wg_adopt");
        expect(adopted.hostVersion).to.equal(2);
        expect(engine.currentText).to.equal(typed);
        // The full-range WorkspaceEdit change flows back — recognized as OUR
        // echo, not bounced to Monaco.
        const echo = engine.onHostTextChanged(typed, [], "hostEdit");
        expect(echo.remote?.reason).to.equal("echo");
        expect(echo.remote?.echoOfEditGroupId).to.equal("wg_adopt");
        // Normal editing continues against the adopted version.
        const group = webviewGroup(engine, [{ start: 0, end: 0, text: "-- " }], "g2");
        expect(engine.applyWebviewEdits(group.edits).applied).to.equal(true);
    });
});

suite("Query Studio document registry", () => {
    interface TestModel {
        uriKey: string;
        panelCount: number;
        disposed: boolean;
        dispose(): void;
    }
    const makeRegistry = () =>
        new QueryStudioDocumentRegistry<TestModel>((uriKey) => ({
            uriKey,
            panelCount: 0,
            disposed: false,
            dispose() {
                this.disposed = true;
            },
        }));

    test("one model per URI; multiple panels share it", () => {
        const registry = makeRegistry();
        const a = registry.attach("file:///q1.sql");
        const b = registry.attach("file:///q1.sql");
        expect(a).to.equal(b);
        expect(a.panelCount).to.equal(2);
        expect(registry.size).to.equal(1);
        const other = registry.attach("file:///q2.sql");
        expect(other).to.not.equal(a);
        expect(registry.size).to.equal(2);
    });

    test("model disposes only when the LAST panel detaches", () => {
        const registry = makeRegistry();
        const model = registry.attach("file:///q1.sql");
        registry.attach("file:///q1.sql");
        expect(registry.detach("file:///q1.sql").disposed).to.equal(false);
        expect(model.disposed).to.equal(false);
        expect(registry.detach("file:///q1.sql").disposed).to.equal(true);
        expect(model.disposed).to.equal(true);
        expect(registry.size).to.equal(0);
    });

    test("Save As rekey preserves the model; collision refuses", () => {
        const registry = makeRegistry();
        const model = registry.attach("untitled:Untitled-1");
        expect(registry.rekey("untitled:Untitled-1", "file:///saved.sql")).to.equal(true);
        expect(registry.peek("file:///saved.sql")).to.equal(model);
        expect(registry.peek("untitled:Untitled-1")).to.equal(undefined);
        registry.attach("file:///other.sql");
        expect(registry.rekey("file:///saved.sql", "file:///other.sql")).to.equal(false);
    });

    test("disposeAll sweeps every model (deactivate path)", async () => {
        const registry = makeRegistry();
        const a = registry.attach("file:///a.sql");
        const b = registry.attach("file:///b.sql");
        await registry.disposeAll();
        expect(a.disposed).to.equal(true);
        expect(b.disposed).to.equal(true);
        expect(registry.size).to.equal(0);
    });
});
