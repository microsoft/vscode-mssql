/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    ContainerEngine,
    ContainerEnginePrerequisite,
    getContainerEnginePrerequisites,
} from "../../src/sharedInterfaces/azureSqlDatabase";
import { detectContainerEngines } from "../../src/deployment/azureSqlHelpers";

suite("Container engine prerequisites", () => {
    test("includes the configuration check for Docker", () => {
        expect(getContainerEnginePrerequisites(ContainerEngine.Docker)).to.deep.equal([
            ContainerEnginePrerequisite.Installation,
            ContainerEnginePrerequisite.Running,
            ContainerEnginePrerequisite.Configuration,
        ]);
    });

    for (const engine of [
        ContainerEngine.Podman,
        ContainerEngine.Containerd,
        ContainerEngine.AppleContainer,
        ContainerEngine.WslContainer,
    ]) {
        test(`does not include a separate configuration check for ${engine}`, () => {
            expect(getContainerEnginePrerequisites(engine)).to.deep.equal([
                ContainerEnginePrerequisite.Installation,
                ContainerEnginePrerequisite.Running,
            ]);
        });
    }

    test("detects engines using only the installation prerequisite", async () => {
        const checkedEngines: ContainerEngine[] = [];
        const detectedEngine = ContainerEngine.Podman;

        const results = await detectContainerEngines(async (engine, prerequisite) => {
            expect(prerequisite).to.equal(ContainerEnginePrerequisite.Installation);
            checkedEngines.push(engine);
            return { success: engine === detectedEngine };
        });

        expect(checkedEngines).to.have.members(Object.values(ContainerEngine));
        expect(results[detectedEngine].success).to.be.true;
        expect(results[ContainerEngine.Docker].success).to.be.false;
    });
});
