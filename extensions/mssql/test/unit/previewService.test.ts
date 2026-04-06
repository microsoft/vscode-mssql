/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as vscode from "vscode";
import {
    CONFIG_PREVIEW_PREFIX,
    PreviewFeature,
    PreviewFeaturesService,
} from "../../src/previews/previewService";
import { createWorkspaceConfiguration } from "./stubs";
import { TestFeature } from "./utils";

suite("PreviewFeaturesService", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let service: PreviewFeaturesService;

    setup(() => {
        sandbox = sinon.createSandbox();
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
        // Default: no config set
        getConfigurationStub.returns(createWorkspaceConfiguration({}));
        service = PreviewFeaturesService.getInstance();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (PreviewFeature as any)["TestFeature"] = TestFeature; // Add a fake feature for testing
    });

    teardown(() => {
        sandbox.restore();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (PreviewFeature as any)["TestFeature"]; // Clean up the fake feature
    });

    suite("experimentalFeaturesEnabled", () => {
        test("returns true when enableExperimentalFeatures is true", () => {
            stubMssqlConfig(true);
            expect(service.experimentalFeaturesEnabled).to.be.true;
        });

        test("returns false when enableExperimentalFeatures is false", () => {
            stubMssqlConfig(false);
            expect(service.experimentalFeaturesEnabled).to.be.false;
        });

        test("returns false when enableExperimentalFeatures is not set", () => {
            stubMssqlConfig(undefined);
            expect(service.experimentalFeaturesEnabled).to.be.false;
        });
    });

    suite("isFeatureEnabled - no per-feature override", () => {
        test("returns true when global flag is true and no override", () => {
            stubMssqlConfig(true);

            expect(service.isFeatureEnabled(TestFeature)).to.be.true;
        });

        test("returns false when global flag is false and no override", () => {
            stubMssqlConfig(false);

            expect(service.isFeatureEnabled(TestFeature)).to.be.false;
        });

        test("returns false when global flag is not set and no override", () => {
            stubMssqlConfig(undefined);
            expect(service.isFeatureEnabled(TestFeature)).to.be.false;
        });
    });

    suite("isFeatureEnabled - per-feature override takes precedence", () => {
        test("global disabled, but override is enabled", () => {
            stubMssqlConfig(false, { [TestFeature]: true });
            expect(service.isFeatureEnabled(TestFeature)).to.be.true;
        });

        test("global enabled, but override is disabled", () => {
            stubMssqlConfig(true, { [TestFeature]: false });
            expect(service.isFeatureEnabled(TestFeature)).to.be.false;
        });

        test("both global and override enabled", () => {
            stubMssqlConfig(true, { [TestFeature]: true });
            expect(service.isFeatureEnabled(TestFeature)).to.be.true;
        });

        test("both global and override disabled", () => {
            stubMssqlConfig(false, { [TestFeature]: false });
            expect(service.isFeatureEnabled(TestFeature)).to.be.false;
        });
    });

    suite("getNonDefaultOverrides", () => {
        test("returns empty object when no per-feature overrides are set", () => {
            stubMssqlConfig(true);
            expect(service.getNonDefaultOverrides()).to.deep.equal({});
        });

        test("returns empty object when override matches global flag", () => {
            // both true
            stubMssqlConfig(true, { [TestFeature]: true });
            expect(service.getNonDefaultOverrides()).to.deep.equal({});

            // both false
            getConfigurationStub.reset();
            stubMssqlConfig(false, { [TestFeature]: false });
            expect(service.getNonDefaultOverrides()).to.deep.equal({});
        });

        test("includes feature when override differs from global flag", () => {
            // override true + global false
            stubMssqlConfig(false, { [TestFeature]: true });
            expect(service.getNonDefaultOverrides()).to.deep.equal({
                [TestFeature]: true,
            });

            // override false + global true
            getConfigurationStub.reset();
            stubMssqlConfig(true, { [TestFeature]: false });
            expect(service.getNonDefaultOverrides()).to.deep.equal({
                [TestFeature]: false,
            });
        });
    });

    /**
     * Build a WorkspaceConfiguration stub for the "mssql" section.
     * @param globalEnabled value of `mssql.enableExperimentalFeatures` (undefined = not set)
     * @param featureOverrides map of feature name → explicit per-feature value
     */
    function stubMssqlConfig(
        globalEnabled: boolean | undefined,
        featureOverrides: Partial<Record<PreviewFeature, boolean>> = {},
    ): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const items: { [key: string]: any } = {};

        if (globalEnabled !== undefined) {
            items["enableExperimentalFeatures"] = globalEnabled;
        }

        for (const [feature, value] of Object.entries(featureOverrides)) {
            items[`${CONFIG_PREVIEW_PREFIX}${feature}`] = value;
        }

        const config = createWorkspaceConfiguration(items);
        getConfigurationStub.returns(config);
    }
});
