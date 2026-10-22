/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as sinon from "sinon";
import * as Constants from "../../src/constants/constants";
import * as chai from "chai";
import sinonChai from "sinon-chai";
import {
    disableAiCompletions,
    enableAiCompletions,
    getCompletionsEnablementStatus,
} from "../../src/copilot/inlineCompletionEnablement";
import { configureCompletionsDebugHost } from "../../src/diagnostics/completionsDebugConsoleHost";
import { InlineCompletionReplayService } from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionReplayService";
import {
    InlineCompletionCaptureService,
    pickDefaultModelOption,
} from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionCaptureService";
import { createDefaultInlineCompletionDebugHostServices } from "../../src/copilot/inlineCompletionDebug/services/inlineCompletionDebugHostServices";
import {
    inlineCompletionDebugStore,
    inlineCompletionDebugDefaultOverrides,
} from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugStore";
import { defaultInlineCompletionModelPreference } from "../../src/copilot/inlineCompletionDebug/inlineCompletionDebugProfiles";
import { InlineCompletionDebugEvent } from "../../src/sharedInterfaces/inlineCompletionDebug";

const { expect } = chai;
chai.use(sinonChai);

suite("Completion debug private-preview integration", () => {
    const sandbox = sinon.createSandbox();
    let settings: Map<string, unknown>;
    let update: sinon.SinonStub;

    setup(() => {
        settings = new Map();
        update = sandbox.stub().callsFake(async (key: string, value: unknown) => {
            settings.set(key, value);
        });
        sandbox.stub(vscode.workspace, "getConfiguration").callsFake((section) => {
            if (section === "github.copilot") {
                return {
                    get: () => ({ sql: false }),
                    inspect: () => ({ globalValue: { sql: false } }),
                    update,
                } as unknown as vscode.WorkspaceConfiguration;
            }
            return {
                get: (key: string, fallback: unknown) =>
                    settings.get(section ? `${section}.${key}` : key) ?? fallback,
                update,
            } as unknown as vscode.WorkspaceConfiguration;
        });
        configureCompletionsDebugHost(undefined);
    });

    teardown(() => {
        inlineCompletionDebugStore.updateOverrides(inlineCompletionDebugDefaultOverrides);
        configureCompletionsDebugHost(undefined);
        sandbox.restore();
    });

    for (const hasWorkspace of [false, true]) {
        test(`capture settings write to User settings with workspace=${hasWorkspace}`, async () => {
            sandbox
                .stub(vscode.workspace, "workspaceFolders")
                .value(
                    hasWorkspace
                        ? [{ uri: vscode.Uri.file("/test-workspace"), name: "test", index: 0 }]
                        : undefined,
                );
            const host = createDefaultInlineCompletionDebugHostServices();
            for (const [key, value] of [
                [Constants.configCopilotInlineCompletionsDebugRecordWhenClosed, true],
                [Constants.configCopilotInlineCompletionsTraceCaptureEnabled, true],
                [Constants.configCopilotInlineCompletionsTraceFolder, "/test-traces"],
            ] as const) {
                await host.updateConfiguration(key, value);
                expect(update).to.have.been.calledWith(
                    key,
                    value,
                    vscode.ConfigurationTarget.Global,
                );
            }
        });
    }

    test("editing a model preserves schema and category opt-outs", () => {
        sandbox.stub(vscode.lm, "selectChatModels").resolves([]);
        settings.set("mssql.copilot.inlineCompletions.profile", "balanced");
        settings.set("mssql.copilot.inlineCompletions.enabledCategories", ["intent"]);
        inlineCompletionDebugStore.updateOverrides(inlineCompletionDebugDefaultOverrides);
        const service = new InlineCompletionCaptureService({
            extensionContext: {
                workspaceState: { get: (_key: string, fallback: unknown) => fallback },
            } as unknown as vscode.ExtensionContext,
            hostServices: createDefaultInlineCompletionDebugHostServices(),
        });
        try {
            const overrides = service.prepareUserOverrideUpdate({
                modelSelector: "copilot:chosen",
            });
            expect(overrides.profileId).to.equal("custom");
            expect(overrides.useSchemaContext).to.equal(false);
            expect(overrides.enabledCategories).to.deep.equal(["intent"]);
        } finally {
            service.dispose();
        }
    });

    test("the viewer honors an explicit model setting ahead of preset preferences", () => {
        const model = (id: string) => ({
            id,
            name: id,
            family: id,
            vendor: "copilot",
            version: "1",
            selector: `copilot:${id}`,
            label: id,
            providerLabel: "GitHub Copilot",
        });
        const preferred = model("gpt-6.1-sol");
        const chosen = model("selected-model");
        expect(
            pickDefaultModelOption(
                [preferred, chosen],
                chosen.selector,
                defaultInlineCompletionModelPreference,
            ),
        ).to.equal(chosen);
    });

    test("enabling requires activation and leaves schema sharing unchanged", async () => {
        const status = await enableAiCompletions();
        expect(settings.get("mssql.enableExperimentalFeatures")).to.equal(true);
        expect(settings.get("mssql.copilot.inlineCompletions.enabled")).to.equal(true);
        expect(settings.has("mssql.copilot.inlineCompletions.useSchemaContext")).to.equal(false);
        expect(status.featureEnabled).to.equal(false);
        configureCompletionsDebugHost({ extensionContext: {} as vscode.ExtensionContext });
        expect(getCompletionsEnablementStatus().featureEnabled).to.equal(true);
    });

    test("disabling leaves schema and other preview choices intact", async () => {
        settings.set("mssql.enableExperimentalFeatures", true);
        settings.set("mssql.copilot.inlineCompletions.enabled", true);
        settings.set("mssql.copilot.inlineCompletions.useSchemaContext", true);
        configureCompletionsDebugHost({ extensionContext: {} as vscode.ExtensionContext });
        expect((await disableAiCompletions()).featureEnabled).to.equal(false);
        expect(settings.get("mssql.enableExperimentalFeatures")).to.equal(true);
        expect(settings.get("mssql.copilot.inlineCompletions.useSchemaContext")).to.equal(true);
    });

    test("a disabled replay cannot select or call a model", async () => {
        const selectModel = sandbox.stub();
        const service = new InlineCompletionReplayService({
            extensionContext: {} as vscode.ExtensionContext,
            schemaContextService: undefined,
            captureService: sandbox.createStubInstance(InlineCompletionCaptureService),
            selectModel,
            isFeatureEnabled: () => false,
        });
        try {
            expect(await service.replaySourceEvent({} as InlineCompletionDebugEvent)).to.equal(
                undefined,
            );
            expect(selectModel.called).to.equal(false);
        } finally {
            service.dispose();
        }
    });
});
