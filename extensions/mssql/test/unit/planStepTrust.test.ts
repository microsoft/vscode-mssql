/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { RunbookPlanNode } from "../../src/sharedInterfaces/runbookStudio";
import {
    humanizePlanTrustToken,
    planTrustTone,
    projectPlanStepTrust,
} from "../../src/webviews/pages/RunbookStudio/planStepTrust";

function activity(overrides: Partial<RunbookPlanNode> = {}): RunbookPlanNode {
    return {
        id: "provision",
        label: "Provision container",
        kind: "activity",
        activityKind: "sql.container.provision",
        activityVersion: 1,
        blastRadius: {
            resource: "container",
            operation: "provision",
            targetEnvironment: "ephemeral",
            reversibility: "autoReversible",
        },
        ...overrides,
    };
}

suite("planStepTrust", () => {
    test("projects compiler-owned target environment, effect, and recovery facts", () => {
        const summary = projectPlanStepTrust(activity(), []);

        expect(summary).to.deep.equal({
            environment: "ephemeral",
            operation: "provision",
            resource: "container",
            reversibility: "autoReversible",
            approval: undefined,
        });
        expect(planTrustTone("environment", summary)).to.equal("default");
        expect(planTrustTone("reversibility", summary)).to.equal("ok");
    });

    test("distinguishes an approval gate from its protected effect", () => {
        const gate = activity({ id: "approve", kind: "gate", activityKind: undefined });
        const effect = activity();

        expect(projectPlanStepTrust(gate, []).approval).to.equal("gate");
        expect(
            projectPlanStepTrust(effect, [{ from: "approve", to: "provision", when: "approved" }])
                .approval,
        ).to.equal("protected");
    });

    test("marks production and manual recovery facts as warnings without parsing prose", () => {
        const summary = projectPlanStepTrust(
            activity({
                blastRadius: {
                    resource: "databaseSchema",
                    operation: "modify",
                    targetEnvironment: "approvedReadOnlyProduction",
                    reversibility: "manualReversible",
                },
            }),
            [],
        );

        expect(planTrustTone("environment", summary)).to.equal("warn");
        expect(planTrustTone("reversibility", summary)).to.equal("warn");
        expect(humanizePlanTrustToken("approvedReadOnlyProduction")).to.equal(
            "approved read only production",
        );
        expect(humanizePlanTrustToken("databaseSchema")).to.equal("database schema");
    });
});
