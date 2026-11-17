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
import { getFeatureHintInput } from "../../src/sharedInterfaces/userSurvey";
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

function fakeModel(family: string, response = '{"featureIds": []}') {
    return {
        id: family,
        family,
        sendRequest: sinon.stub().resolves({
            text: (async function* () {
                yield response;
            })(),
        }),
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

    test("Copilot response parsing keeps only known, unique ids", () => {
        const known = ["schemaCompare", "keymap"];
        expect(
            parseCopilotFeatureHintResponse(
                '```json\n{"featureIds": ["schemaCompare", "invented", "schemaCompare", 3]}\n```',
                known,
            ),
        ).to.deep.equal(["schemaCompare"]);
        expect(parseCopilotFeatureHintResponse("not json {", known)).to.deep.equal([]);
        expect(parseCopilotFeatureHintResponse('{"featureIds": "keymap"}', known)).to.deep.equal(
            [],
        );
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
        const ids = (suggestions: { id: string }[]) => suggestions.map((s) => s.id);

        test("does not check anything when the score is above the threshold", async () => {
            const selectModel = sandbox.stub().resolves(fakeModel("gpt-5.4-mini"));
            const service = new FeatureHintService([keywordHint, copilotHint], selectModel);

            expect(await service.findHints({ ...eligible, score: 9 })).to.deep.equal([]);
            expect(selectModel).to.not.have.been.called;
        });

        test("returns keyword and Copilot matches together when signed in", async () => {
            const model = fakeModel("gpt-5.4-mini", '{"featureIds": ["schemaCompare"]}');
            const service = new FeatureHintService([keywordHint, copilotHint], async () => model);

            expect(await service.findHints(eligible)).to.deep.equal([
                {
                    id: "keymap",
                    featureName: "Keymap",
                    description: "Familiar shortcuts.",
                    hasDocs: true,
                    canTryNow: false,
                    tryNowLabel: undefined,
                },
                {
                    id: "schemaCompare",
                    featureName: "Schema Compare",
                    description: "Compare schemas.",
                    hasDocs: false,
                    canTryNow: true,
                    tryNowLabel: undefined,
                },
            ]);
            const prompt = (
                model.sendRequest.firstCall.args[0] as vscode.LanguageModelChatMessage[]
            )
                .map((message) => JSON.stringify(message.content))
                .join("");
            expect(prompt).to.include("schemaCompare").and.not.include('"keymap"');
        });

        test("returns only keyword matches when not signed in to Copilot", async () => {
            const service = new FeatureHintService(
                [keywordHint, copilotHint],
                async () => undefined,
            );
            expect(ids(await service.findHints(eligible))).to.deep.equal(["keymap"]);
        });

        test("does not look up a model when no hint uses Copilot", async () => {
            const selectModel = sandbox.stub().resolves(fakeModel("gpt-5.4-mini"));
            const service = new FeatureHintService([keywordHint], selectModel);

            await service.findHints(eligible);
            expect(selectModel).to.not.have.been.called;
        });

        test("keeps keyword matches when the Copilot request fails", async () => {
            const model = fakeModel("gpt-5.4-mini");
            model.sendRequest.rejects(new Error("quota"));
            const service = new FeatureHintService([keywordHint, copilotHint], async () => model);

            expect(ids(await service.findHints(eligible))).to.deep.equal(["keymap"]);
        });

        test("attributes action telemetry to the hint's match mode", () => {
            const sendActionEvent = telemetryStub;
            const service = new FeatureHintService(
                [keywordHint, copilotHint],
                async () => undefined,
            );

            service.reportAction("tryNow", "schemaCompare");
            service.reportAction("docs", "unknown");

            expect(sendActionEvent).to.have.been.calledOnceWithExactly(
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
