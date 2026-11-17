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

    setup(() => {
        sandbox = sinon.createSandbox();
        stubTelemetry(sandbox);
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

        test("does not suggest anything when the score is above the threshold", async () => {
            const service = new FeatureHintService([keywordHint], async () => undefined);
            expect(await service.findHints({ ...eligible, score: 9 }, "keyword")).to.deep.equal({
                status: "notEligible",
                suggestions: [],
            });
        });

        test("keyword checks never call Copilot", async () => {
            const selectModel = sandbox.stub().resolves(fakeModel("gpt-5.4-mini"));
            const service = new FeatureHintService([keywordHint, copilotHint], selectModel);

            const result = await service.findHints(eligible, "keyword");

            expect(result.suggestions.map((suggestion) => suggestion.id)).to.deep.equal(["keymap"]);
            expect(selectModel).to.not.have.been.called;
        });

        test("Copilot checks add Copilot matches to keyword matches", async () => {
            const model = fakeModel("gpt-5.4-mini", '{"featureIds": ["schemaCompare"]}');
            const service = new FeatureHintService([keywordHint, copilotHint], async () => model);

            const result = await service.findHints(eligible, "copilot");

            expect(result).to.deep.equal({
                status: "ok",
                suggestions: [
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
                ],
            });
            const prompt = (
                model.sendRequest.firstCall.args[0] as vscode.LanguageModelChatMessage[]
            )
                .map((message) => JSON.stringify(message.content))
                .join("");
            expect(prompt).to.include("schemaCompare").and.not.include('"keymap"');
        });

        test("reports Copilot as unavailable when the user is not signed in", async () => {
            const service = new FeatureHintService(
                [keywordHint, copilotHint],
                async () => undefined,
            );

            expect(await service.isCopilotAvailable()).to.be.false;
            expect((await service.findHints(eligible, "copilot")).status).to.equal("unavailable");
        });

        test("reports Copilot as unavailable when no hint uses Copilot", async () => {
            const service = new FeatureHintService([keywordHint], async () =>
                fakeModel("gpt-5.4-mini"),
            );
            expect(await service.isCopilotAvailable()).to.be.false;
        });

        test("keeps keyword matches when the Copilot request fails", async () => {
            const model = fakeModel("gpt-5.4-mini");
            model.sendRequest.rejects(new Error("quota"));
            const service = new FeatureHintService([keywordHint, copilotHint], async () => model);

            const result = await service.findHints(eligible, "copilot");

            expect(result.status).to.equal("error");
            expect(result.suggestions.map((suggestion) => suggestion.id)).to.deep.equal(["keymap"]);
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
