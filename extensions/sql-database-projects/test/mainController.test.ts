/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as sinon from "sinon";
import * as baselines from "./baselines/baselines";
import * as templates from "../src/templates/templates";
import { createContext, TestContext } from "./testContext";
import MainController from "../src/controllers/mainController";
import { getTemplatesRootPath } from "./testUtils";

let testContext: TestContext;
const templatesPath = getTemplatesRootPath();

suite("MainController: main controller operations", function (): void {
    suiteSetup(async function (): Promise<void> {
        testContext = createContext();
        await templates.loadTemplates(templatesPath);
        await baselines.loadBaselines();
    });

    teardown(function (): void {
        sinon.restore();
    });

    test("Should create new instance without error", async function (): Promise<void> {
        expect(
            () => new MainController(testContext.context),
            "Creating controller should not throw an error",
        ).to.not.throw();
    });

    test("Should activate and deactivate without error", async function (): Promise<void> {
        let controller = new MainController(testContext.context);
        expect(controller.extensionContext, "Extension context should be defined").to.not.equal(
            undefined,
        );

        expect(() => controller.activate(), "activate() should not throw an error").to.not.throw();
        expect(() => controller.dispose(), "dispose() should not throw an error").to.not.throw();
    });
});
