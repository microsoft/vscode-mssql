/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import { expect } from "chai";
import * as vscode from "vscode";
import { PreviewFeature, PreviewFeaturesService } from "../../src/previews/previewService";
import { createWorkspaceConfiguration } from "./stubs";

suite("PreviewFeaturesService", () => {
    let sandbox: sinon.SinonSandbox;
    let getConfigurationStub: sinon.SinonStub;
    let service: PreviewFeaturesService;

    /**
     * Build a WorkspaceConfiguration stub for the "mssql" section.
     * @param globalEnabled value of `mssql.enableExperimentalFeatures` (undefined = not set)
     * @param featureOverrides map of feature name → explicit per-feature value
     */
    function stubMssqlConfig(
        globalEnabled: boolean | undefined,
        featureOverrides: Partial<Record<PreviewFeature, boolean>> = {},
    ): void {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const items: { [key: string]: any } = {};
        /* eslint-enable @typescript-eslint/no-explicit-any */

        if (globalEnabled !== undefined) {
            items["enableExperimentalFeatures"] = globalEnabled;
        }

        for (const [feature, value] of Object.entries(featureOverrides)) {
            items[`preview.${feature}`] = value;
        }

        const config = createWorkspaceConfiguration(items);
        getConfigurationStub.withArgs("mssql").returns(config);
    }

    setup(() => {
        sandbox = sinon.createSandbox();
        getConfigurationStub = sandbox.stub(vscode.workspace, "getConfiguration");
        // Default: no config set
        getConfigurationStub.returns(createWorkspaceConfiguration({}));
        service = PreviewFeaturesService.getInstance();
    });

    teardown(() => {
        sandbox.restore();
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
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.true;
        });

        test("returns false when global flag is false and no override", () => {
            stubMssqlConfig(false);
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.false;
        });

        test("returns false when global flag is not set and no override", () => {
            stubMssqlConfig(undefined);
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.false;
        });
    });

    // -------------------------------------------------------------------------
    suite("isFeatureEnabled - per-feature override takes precedence", () => {
        test("override true + global false → enabled", () => {
            stubMssqlConfig(false, { [PreviewFeature.TableNodeAction]: true });
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.true;
        });

        test("override false + global true → disabled", () => {
            stubMssqlConfig(true, { [PreviewFeature.TableNodeAction]: false });
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.false;
        });

        test("override true + global true → still enabled", () => {
            stubMssqlConfig(true, { [PreviewFeature.TableNodeAction]: true });
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.true;
        });

        test("override false + global false → still disabled", () => {
            stubMssqlConfig(false, { [PreviewFeature.TableNodeAction]: false });
            expect(service.isFeatureEnabled(PreviewFeature.TableNodeAction)).to.be.false;
        });
    });

    // -------------------------------------------------------------------------
    suite("getNonDefaultOverrides", () => {
        test("returns empty object when no per-feature overrides are set", () => {
            stubMssqlConfig(true);
            expect(service.getNonDefaultOverrides()).to.deep.equal({});
        });

        test("returns empty object when override matches global flag (both true)", () => {
            stubMssqlConfig(true, { [PreviewFeature.TableNodeAction]: true });
            expect(service.getNonDefaultOverrides()).to.deep.equal({});
        });

        test("returns empty object when override matches global flag (both false)", () => {
            stubMssqlConfig(false, { [PreviewFeature.TableNodeAction]: false });
            expect(service.getNonDefaultOverrides()).to.deep.equal({});
        });

        test("includes feature when override is true and global is false", () => {
            stubMssqlConfig(false, { [PreviewFeature.TableNodeAction]: true });
            expect(service.getNonDefaultOverrides()).to.deep.equal({
                [PreviewFeature.TableNodeAction]: true,
            });
        });

        test("includes feature when override is false and global is true", () => {
            stubMssqlConfig(true, { [PreviewFeature.TableNodeAction]: false });
            expect(service.getNonDefaultOverrides()).to.deep.equal({
                [PreviewFeature.TableNodeAction]: false,
            });
        });
    });
});
