/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as vscode from "vscode";
import { previewService } from "../../src/previews/previewService";
import * as services from "../../src/queryResults/queryResultAccessService";
import * as contexts from "../../src/queryResults/queryResultContextService";
import * as settings from "../../src/queryResults/queryResultsParams";
import { registerQueryParticipant } from "../../src/queryResults/queryParticipant";
import { QueryResultsTool } from "../../src/queryResults/queryResultsTool";
import { boundResultModelCell } from "../../src/queryResults/resultModelContent";
import { QueryResultSnapshotDescription } from "../../src/queryResults/queryResultTypes";
import { TransformResult } from "../../src/queryResults/transformEngine";
import { TransformSpec, validateTransformSpec } from "../../src/queryResults/transformSpec";

suite("Query results chat boundaries", () => {
    const sandbox = sinon.createSandbox();
    // The participant's facade is window-scoped; retain its service instance across requests.
    const serviceSandbox = sinon.createSandbox();
    let service: sinon.SinonStubbedInstance<services.QueryResultAccessService>;
    suiteSetup(() => {
        service = serviceSandbox.createStubInstance(services.QueryResultAccessService);
    });
    suiteTeardown(() => serviceSandbox.restore());
    let handler: vscode.ChatRequestHandler;
    let params: settings.QueryResultsParams;
    let messages: string[];
    let stream: vscode.ChatResponseStream;
    let sendRequest: sinon.SinonStub;
    let cancellation: vscode.CancellationTokenSource;
    const description = {
        snapshotId: "snapshot",
        source: { sourceTitle: "test results" },
        totalRows: 20,
        resultSetCount: 1,
        resultSets: [{ resultSetId: "rs", columnNames: ["value"], rowCount: 20 }],
    } as unknown as QueryResultSnapshotDescription;

    function result(rows: unknown[][]): TransformResult {
        return {
            columns: ["value"],
            rows,
            outputClass: "values",
            specDigest: "test",
            stats: {
                rowsScanned: 20,
                rowsMatched: 20,
                elapsedMs: 0,
                partial: false,
                truncatedCellsSkipped: 0,
            },
        };
    }

    async function chat(command: string) {
        await handler(
            { command, model: { sendRequest } } as unknown as vscode.ChatRequest,
            {} as vscode.ChatContext,
            stream,
            cancellation.token,
        );
    }

    setup(() => {
        for (const stub of [
            service.describeSnapshot,
            service.listLiveSources,
            service.listSnapshots,
            service.createSnapshot,
            service.evaluateSnapshotTransform,
            service.disposeUnleasedSnapshot,
        ]) {
            if (typeof stub === "function" && "reset" in stub) (stub as sinon.SinonStub).reset();
        }
        params = { ...settings.QUERY_RESULTS_DEFAULTS, aiEnabled: true };
        sandbox
            .stub(settings, "resolveQueryResultsParams")
            .callsFake(() => ({ params, digest: "test", overriddenKeys: [] }));
        sandbox.stub(previewService, "isPrivatePreviewEnabled").returns(true);
        sandbox.stub(services, "getQueryResultAccessService").returns(service);
        sandbox
            .stub(contexts, "getQueryResultContextService")
            .returns(new contexts.QueryResultContextService());
        service.describeSnapshot.returns(description);
        service.listLiveSources.returns([
            {
                sourceId: "source",
                sourceTitle: "test results",
                resultSetCount: 1,
                streaming: false,
                totalRows: 20,
            } as ReturnType<services.QueryResultAccessService["listLiveSources"]>[number],
        ]);
        service.listSnapshots.returns([]);
        service.createSnapshot.resolves({
            snapshotId: "snapshot",
            leaseId: "lease",
            owner: { kind: "aiTool" },
            dispose: () => undefined,
        });
        service.evaluateSnapshotTransform.resolves(result([[20, 0]]));
        const create = sandbox
            .stub(vscode.chat, "createChatParticipant")
            .returns({ dispose() {} } as vscode.ChatParticipant);
        registerQueryParticipant({
            extensionUri: vscode.Uri.file(__dirname),
            subscriptions: [],
        } as unknown as vscode.ExtensionContext);
        handler = create.firstCall.args[1];
        messages = [];
        stream = {
            markdown: (value: string) => messages.push(value),
            progress: () => undefined,
        } as unknown as vscode.ChatResponseStream;
        sendRequest = sandbox.stub().resolves({
            text: (async function* () {
                yield "report";
            })(),
        });
        cancellation = new vscode.CancellationTokenSource();
    });

    teardown(() => {
        try {
            cancellation?.dispose();
        } finally {
            sandbox.restore();
        }
    });

    test("AI result access defaults off and obeys the complete Query Studio gate", async () => {
        expect(settings.QUERY_RESULTS_DEFAULTS.aiEnabled).to.equal(false);
        (previewService.isPrivatePreviewEnabled as sinon.SinonStub).returns(false);
        await chat("summarize");
        const response = await new QueryResultsTool().call(
            { input: { operation: "list_live" }, toolInvocationToken: undefined },
            cancellation.token,
        );
        expect(JSON.parse(response).success).to.equal(false);
        expect(service.listLiveSources.called).to.equal(false);
    });

    test("repeated chat summaries release their temporary snapshots", async () => {
        for (let i = 0; i < 8; i++) await chat("summarize");
        expect(service.disposeUnleasedSnapshot.alwaysCalledWith("snapshot", "aiReleased")).to.equal(
            true,
        );
        expect(service.disposeUnleasedSnapshot.callCount).to.equal(8);
    });

    test("declining a profile reads only value-free aggregates", async () => {
        sandbox.stub(vscode.window, "showWarningMessage").resolves(undefined);
        await chat("profile");
        const spec = service.evaluateSnapshotTransform.firstCall.args[0];
        expect(spec.terminal).to.deep.equal({
            kind: "aggregate",
            aggs: [{ fn: "count" }, { fn: "nullCount", col: 0 }],
        });
        expect(sendRequest.called).to.equal(false);
    });

    test("report sample size honors configured rows and UTF8 cell bounds", async () => {
        params.aiMaxRowsPerResponse = 2;
        params.aiMaxCellBytes = 256;
        sandbox.stub(vscode.window, "showWarningMessage").resolves("Allow once" as never);
        service.evaluateSnapshotTransform.callsFake(async (spec) =>
            spec.terminal.kind === "sample"
                ? result([["界".repeat(400)], ["🙂".repeat(400)]])
                : result([[20, 0]]),
        );
        await chat("report");
        expect(
            service.evaluateSnapshotTransform
                .getCalls()
                .some(
                    (call) =>
                        call.args[0].terminal.kind === "sample" && call.args[0].terminal.n === 2,
                ),
        ).to.equal(true);
        const prompt = sendRequest.firstCall.args[0][0].content[0].value as string;
        expect(prompt).to.include("DATA_");
        expect(prompt).not.to.include("界".repeat(100));
        expect(prompt).not.to.include("\ufffd");
    });

    test("canceling during consent does not read values or invoke a model", async () => {
        sandbox.stub(vscode.window, "showWarningMessage").callsFake(async () => {
            cancellation.cancel();
            return "Allow once" as never;
        });
        await chat("report");
        expect(
            service.evaluateSnapshotTransform
                .getCalls()
                .every((call) => call.args[0].terminal.kind === "aggregate"),
        ).to.equal(true);
        expect(sendRequest.called).to.equal(false);
        expect(service.disposeUnleasedSnapshot.calledWith("snapshot", "aiReleased")).to.equal(true);
    });

    test("chat and tool pin commands honor the existing pinning setting", async () => {
        params.pinnedDocumentsEnabled = false;
        await chat("pin");
        expect(service.createSnapshot.called).to.equal(false);
        const response = await new QueryResultsTool().call(
            {
                input: { operation: "pin_snapshot", snapshotId: "snapshot" },
                toolInvocationToken: undefined,
            },
            cancellation.token,
        );
        expect(JSON.parse(response).success).to.equal(false);
        expect(messages.join(" ")).to.include("disabled");
    });

    test("ambiguous pin does not silently choose the first source", async () => {
        const first = service.listLiveSources()[0];
        service.listLiveSources.returns([first, { ...first, sourceId: "other" }]);
        await chat("pin");
        expect(service.createSnapshot.called).to.equal(false);
        expect(messages.join(" ")).to.include("Focus");
    });

    test("tool transform output is row-capped and explicitly marked truncated", async () => {
        params.aiMaxRowsPerResponse = 2;
        service.evaluateSnapshotTransform.resolves(result([[1], [2], [3]]));
        const spec: TransformSpec = {
            v: 1,
            source: { snapshotId: "snapshot", resultSetId: "rs" },
            terminal: { kind: "rows", limit: 3 },
        };
        const response = await new QueryResultsTool().call(
            { input: { operation: "evaluate_transform", spec }, toolInvocationToken: undefined },
            cancellation.token,
        );
        const payload = JSON.parse(response.split("\n")[2]);
        expect(payload.rows).to.deep.equal([[1], [2]]);
        expect(payload.outputTruncated).to.equal(true);
    });

    test("whole tool response budget counts UTF8 bytes, not characters", async () => {
        params.aiMaxBytesPerResponse = 4096;
        service.listSnapshots.returns([
            { ...description, source: { ...description.source, sourceTitle: "界".repeat(2000) } },
        ]);
        const response = await new QueryResultsTool().call(
            { input: { operation: "list_snapshots" }, toolInvocationToken: undefined },
            cancellation.token,
        );
        expect(JSON.parse(response).truncated).to.equal(true);
        expect(Buffer.byteLength(response, "utf8")).to.be.lessThan(4096);
    });

    test("cell bounds preserve Unicode and remove control characters", () => {
        for (const text of ["界".repeat(100), "🙂".repeat(100)]) {
            const bounded = boundResultModelCell(text, 256) as string;
            expect(Buffer.byteLength(bounded, "utf8")).to.be.at.most(256);
            expect(bounded).not.to.include("\ufffd");
            expect(bounded.endsWith("…")).to.equal(true);
        }
        expect(boundResultModelCell("a\u0000b", 256)).to.equal("a b");
    });

    test("transform limits reject non-finite and fractional inputs without capping row spans to column ordinals", () => {
        for (const invalid of [NaN, Infinity, -1, 1.5]) {
            expect(
                validateTransformSpec({
                    v: 1,
                    source: { snapshotId: "s", resultSetId: "rs" },
                    terminal: { kind: "sample", strategy: "head", n: invalid },
                }).errors,
            ).not.to.equal(undefined);
        }
        expect(
            validateTransformSpec({
                v: 1,
                source: {
                    snapshotId: "s",
                    resultSetId: "rs",
                    rows: { kind: "span", start: 100000, count: 100000 },
                },
                terminal: { kind: "rows", limit: 100000 },
            }).errors,
        ).to.equal(undefined);
    });
});
