/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    runtimeModelIdForRole,
    runtimeProviderProfileForRole,
    setRuntimeModelIdForRole,
} from "../../src/runbookStudio/models/modelConfiguration";

suite("runbookModelConfiguration", () => {
    const document = {
        activeProviderProfileId: "active",
        planningProviderProfileId: "planning",
        executionProviderProfileId: "execution",
        providers: [
            {
                id: "active",
                label: "Active",
                defaultModels: { plannerModelId: "active-large" },
            },
            {
                id: "planning",
                label: "Planning",
                defaultModels: { plannerModelId: "planning-large" },
            },
            {
                id: "execution",
                label: "Execution",
                defaultModels: {
                    plannerModelId: "execution-large",
                    workflowModelId: "execution-fast",
                },
            },
        ],
    };

    test("resolves independent authoring and execution provider profiles", () => {
        expect(runtimeProviderProfileForRole(document, "authoring")?.id).to.equal("planning");
        expect(runtimeProviderProfileForRole(document, "execution")?.id).to.equal("execution");
    });

    test("falls back from role profile to active profile", () => {
        const withoutRoleProfiles = {
            ...document,
            planningProviderProfileId: undefined,
            executionProviderProfileId: "missing",
        };
        expect(runtimeProviderProfileForRole(withoutRoleProfiles, "authoring")?.id).to.equal(
            "active",
        );
        expect(runtimeProviderProfileForRole(withoutRoleProfiles, "execution")?.id).to.equal(
            "active",
        );
    });

    test("execution model falls back to the provider planner model", () => {
        const active = runtimeProviderProfileForRole(document, "authoring")!;
        const execution = runtimeProviderProfileForRole(document, "execution")!;
        expect(runtimeModelIdForRole(active, "execution")).to.equal("planning-large");
        expect(runtimeModelIdForRole(execution, "execution")).to.equal("execution-fast");
    });

    test("updates only the model slot assigned to the selected role", () => {
        const profile = {
            id: "profile",
            defaultModels: { plannerModelId: "large", workflowModelId: "fast" },
        };
        expect(setRuntimeModelIdForRole(profile, "authoring", "new-large")).to.equal(true);
        expect(profile.defaultModels).to.deep.equal({
            plannerModelId: "new-large",
            workflowModelId: "fast",
        });
        expect(setRuntimeModelIdForRole(profile, "execution", "new-fast")).to.equal(true);
        expect(profile.defaultModels.workflowModelId).to.equal("new-fast");
    });
});
