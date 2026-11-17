/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import * as vscode from "vscode";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";

import {
    FeatureHintDefinition,
    findKeywordMatches,
    validateFeatureHintDefinitions,
} from "../../src/nps/featureHints/featureHints";
import { featureHintDefinitions } from "../../src/nps/featureHints/featureHints.config";
import {
    parseCopilotFeatureHintResponse,
    selectCheapCopilotModel,
} from "../../src/nps/featureHints/copilotFeatureHints";
import { FeatureHintService } from "../../src/nps/featureHints/featureHintService";
import { getStandardNPSQuestions } from "../../src/nps/userSurvey";
import { FeatureHintResult, getFeatureHintInput } from "../../src/sharedInterfaces/userSurvey";
import { TelemetryActions, TelemetryViews } from "../../src/sharedInterfaces/telemetry";
import { stubTelemetry } from "./utils";

chai.use(sinonChai);

const keywordHint: FeatureHintDefinition = {
    id: "keymap",
    featureName: "Keymap",
    description: "Familiar shortcuts.",
    docsUrl: "https://example.com/keymap",
    match: { mode: "keyword", keywords: ["F5", "key binding", /\bhot ?keys?\b/gi] },
};

const copilotHint: FeatureHintDefinition = {
    id: "schemaCompare",
    featureName: "Schema Compare",
    description: "Compare schemas.",
    tryNow: { kind: "command", command: "mssql.schemaCompare" },
    match: { mode: "copilot", promptHint: "Compares two database schemas." },
};

function fakeModel(family: string, response = '{"matches": []}') {
    return {
        id: family,
        family,
        sendRequest: sinon.stub().callsFake(async () => ({
            text: (async function* () {
                yield response;
            })(),
        })),
    } as unknown as vscode.LanguageModelChat & { sendRequest: sinon.SinonStub };
}

suite("Survey feature hints", () => {
    let sandbox: sinon.SinonSandbox;
    let telemetryStub: sinon.SinonStub;

    setup(() => {
        sandbox = sinon.createSandbox();
        telemetryStub = stubTelemetry(sandbox).sendActionEvent;
    });

    teardown(() => {
        sandbox.restore();
    });

    test("shipped feature hint config is valid", () => {
        expect(validateFeatureHintDefinitions(featureHintDefinitions)).to.deep.equal([]);
    });

    test("validation reports missing links, non-https URLs, and duplicate ids", () => {
        const problems = validateFeatureHintDefinitions([
            { ...keywordHint, docsUrl: undefined } as unknown as FeatureHintDefinition,
            { ...copilotHint, docsUrl: "http://example.com" },
            { ...copilotHint },
        ]);

        expect(problems).to.deep.equal([
            "Feature hint 'keymap' needs a docsUrl, a tryNow action, or both.",
            "Feature hint 'schemaCompare' has a docsUrl that is not an https URL.",
            "Feature hint 'schemaCompare' is defined more than once.",
        ]);
    });

    const keywordCases: [string, boolean][] = [
        ["Pressing F5 should run the query", true],
        ["f5 does nothing", true],
        ["Support F50 keys", false],
        ["I want a custom key\n  binding", true],
        ["Need HOTKEYS like SSMS", true],
        ["Monkey bindings", false],
        ["", false],
    ];
    for (const [feedback, shouldMatch] of keywordCases) {
        test(`keyword matching ${shouldMatch ? "matches" : "ignores"} ${JSON.stringify(feedback)}`, () => {
            // Repeat to catch state carried by global RegExps.
            for (let i = 0; i < 2; i++) {
                expect(findKeywordMatches(feedback, [keywordHint])).to.have.length(
                    shouldMatch ? 1 : 0,
                );
            }
        });
    }

    const shippedKeywordCases: [string, string[]][] = [
        ["Please add a way to export a BACPAC", ["dataTierApplication"]],
        ["I want to run SQL Server in Docker", ["localContainer"]],
        ["Missing an ERD view of my tables", ["schemaDesigner"]],
        ["Results grid could be faster", []],
    ];
    for (const [feedback, expectedIds] of shippedKeywordCases) {
        test(`shipped keyword hints for ${JSON.stringify(feedback)}`, () => {
            sandbox.stub(vscode.extensions, "getExtension").returns(undefined);
            expect(
                findKeywordMatches(feedback, featureHintDefinitions).map((hint) => hint.id),
            ).to.deep.equal(expectedIds);
        });
    }

    test("skips hints for features already in use", () => {
        expect(
            findKeywordMatches("F5", [{ ...keywordHint, isAlreadyInUse: () => true }]),
        ).to.deep.equal([]);
    });

    test("reads the score and textarea feedback from survey answers", () => {
        const { questions } = getStandardNPSQuestions();
        expect(getFeatureHintInput(questions, { nps: 8, nsat: 1, comments: " F5 " })).to.deep.equal(
            { score: 8, feedback: "F5" },
        );
    });

    test("Copilot response parsing keeps confident, known ids, most confident first", () => {
        const known = ["schemaCompare", "editData", "tableDesigner"];
        const response = JSON.stringify({
            matches: [
                { id: "tableDesigner", confidence: 0.8 },
                { id: "invented", confidence: 0.99 },
                { id: "schemaCompare", confidence: 0.4 },
                { id: "editData", confidence: 0.9 },
                { id: "editData", confidence: 0.75 },
                { id: "schemaCompare" },
            ],
        });

        expect(
            parseCopilotFeatureHintResponse("```json\n" + response + "\n```", known),
        ).to.deep.equal([
            { id: "editData", confidence: 0.9 },
            { id: "tableDesigner", confidence: 0.8 },
        ]);
        expect(parseCopilotFeatureHintResponse("not json {", known)).to.deep.equal([]);
        expect(parseCopilotFeatureHintResponse('{"matches": "editData"}', known)).to.deep.equal([]);
    });

    test("Copilot response parsing never returns more than two features", () => {
        const known = ["a", "b", "c"];
        const response = JSON.stringify({
            matches: known.map((id) => ({ id, confidence: 0.9 })),
        });
        expect(parseCopilotFeatureHintResponse(response, known)).to.have.length(2);
    });

    test("selects only a low-cost Copilot model", async () => {
        const selectChatModels = sandbox.stub(vscode.lm, "selectChatModels");
        selectChatModels.resolves([fakeModel("gemini-4-argon"), fakeModel("gpt-5.4-mini")]);
        expect((await selectCheapCopilotModel())?.family).to.equal("gpt-5.4-mini");
        expect(selectChatModels).to.have.been.calledWith({ vendor: "copilot" });

        selectChatModels.resolves([fakeModel("gemini-4-argon"), fakeModel("claude-opus-5")]);
        expect(await selectCheapCopilotModel()).to.be.undefined;
    });

    suite("FeatureHintService", () => {
        const eligible = { score: 5, feedback: "F5 should run, and I need to diff two databases" };
        const ids = (result: FeatureHintResult) => result.suggestions.map((s) => s.id);
        const copilotResponse = (...matches: [string, number][]) =>
            JSON.stringify({ matches: matches.map(([id, confidence]) => ({ id, confidence })) });
        const editDataHint: FeatureHintDefinition = {
            ...copilotHint,
            id: "editData",
            screenshot: "editData",
        };

        test("does not check anything when the score is above the threshold", async () => {
            const selectModel = sandbox.stub().resolves(fakeModel("gpt-5.4-mini"));
            const service = new FeatureHintService([keywordHint, copilotHint], selectModel);

            expect(await service.findHints({ ...eligible, score: 9 }, "submit")).to.deep.equal({
                suggestions: [],
                copilotStatus: "notRun",
            });
            expect(selectModel).to.not.have.been.called;
        });

        test("returns keyword and Copilot matches together when signed in", async () => {
            const model = fakeModel("gpt-5.4-mini", copilotResponse(["editData", 0.9]));
            const service = new FeatureHintService([keywordHint, editDataHint], async () => model);

            expect(await service.findHints(eligible, "submit")).to.deep.equal({
                suggestions: [
                    {
                        id: "keymap",
                        featureName: "Keymap",
                        description: "Familiar shortcuts.",
                        hasDocs: true,
                        canTryNow: false,
                        tryNowLabel: undefined,
                        screenshot: undefined,
                    },
                    {
                        id: "editData",
                        featureName: "Schema Compare",
                        description: "Compare schemas.",
                        hasDocs: false,
                        canTryNow: true,
                        tryNowLabel: undefined,
                        screenshot: "editData",
                    },
                ],
                copilotStatus: "ok",
            });
            const prompt = (
                model.sendRequest.firstCall.args[0] as vscode.LanguageModelChatMessage[]
            )
                .map((message) => JSON.stringify(message.content))
                .join("");
            expect(prompt).to.include("editData").and.not.include('"keymap"');
        });

        test("suggests two ambiguous Copilot matches but never more than two hints", async () => {
            const tableDesignerHint = { ...copilotHint, id: "tableDesigner" };
            const model = fakeModel(
                "gpt-5.4-mini",
                copilotResponse(["editData", 0.85], ["tableDesigner", 0.8]),
            );
            const service = new FeatureHintService(
                [editDataHint, tableDesignerHint, keywordHint],
                async () => model,
            );

            const ambiguous = { score: 4, feedback: "I want to edit my table in a UX" };
            expect(ids(await service.findHints(ambiguous, "copilotButton"))).to.deep.equal([
                "editData",
                "tableDesigner",
            ]);
            expect(
                ids(
                    await service.findHints(
                        { ...ambiguous, feedback: "F5 " + ambiguous.feedback },
                        "submit",
                    ),
                ),
            ).to.deep.equal(["keymap", "editData"]);
        });

        test("reuses the Copilot answer for unchanged feedback", async () => {
            const model = fakeModel("gpt-5.4-mini", copilotResponse(["schemaCompare", 0.9]));
            const service = new FeatureHintService([copilotHint], async () => model);

            await service.findHints(eligible, "copilotButton");
            expect(ids(await service.findHints(eligible, "submit"))).to.deep.equal([
                "schemaCompare",
            ]);
            expect(model.sendRequest).to.have.been.calledOnce;
        });

        test("returns only keyword matches when not signed in to Copilot", async () => {
            const service = new FeatureHintService(
                [keywordHint, copilotHint],
                async () => undefined,
            );

            expect(await service.isCopilotAvailable()).to.be.false;
            const result = await service.findHints(eligible, "submit");
            expect(ids(result)).to.deep.equal(["keymap"]);
            expect(result.copilotStatus).to.equal("unavailable");
        });

        test("does not look up a model when no hint uses Copilot", async () => {
            const selectModel = sandbox.stub().resolves(fakeModel("gpt-5.4-mini"));
            const service = new FeatureHintService([keywordHint], selectModel);

            expect(await service.isCopilotAvailable()).to.be.false;
            await service.findHints(eligible, "submit");
            expect(selectModel).to.not.have.been.called;
        });

        test("keeps keyword matches when the Copilot request fails", async () => {
            const model = fakeModel("gpt-5.4-mini");
            model.sendRequest.rejects(new Error("quota"));
            const service = new FeatureHintService([keywordHint, copilotHint], async () => model);

            const result = await service.findHints(eligible, "submit");
            expect(ids(result)).to.deep.equal(["keymap"]);
            expect(result.copilotStatus).to.equal("error");
        });

        test("attributes action telemetry to the hint's match mode", () => {
            const service = new FeatureHintService(
                [keywordHint, copilotHint],
                async () => undefined,
            );

            service.reportAction("tryNow", "schemaCompare");
            service.reportAction("docs", "unknown");

            expect(telemetryStub).to.have.been.calledOnceWithExactly(
                TelemetryViews.UserSurvey,
                TelemetryActions.SurveyFeatureHint,
                {
                    additionalProps: {
                        step: "tryNow",
                        hintId: "schemaCompare",
                        source: "copilot",
                    },
                },
            );
        });

        test("ignores invalid definitions", () => {
            const service = new FeatureHintService(
                [{ ...keywordHint, match: { mode: "keyword", keywords: [] } }],
                async () => undefined,
            );
            expect(service.getDefinition("keymap")).to.be.undefined;
        });
    });
});
