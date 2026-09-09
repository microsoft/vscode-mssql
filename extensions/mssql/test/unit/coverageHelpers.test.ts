/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import type { FrameLocator } from "@playwright/test";
import type { CoverageMapData, FileCoverageData } from "istanbul-lib-coverage";
import { getWebviewCoverage } from "../e2e/utils/coverageHelpers";
import { mergeCoverageData } from "../e2e/utils/coverageMerge";

function createCoverageData(filePath: string, visits: number): CoverageMapData {
    const fileCoverage: FileCoverageData = {
        path: filePath,
        statementMap: {
            "0": {
                start: { line: 1, column: 0 },
                end: { line: 1, column: 1 },
            },
        },
        fnMap: {},
        branchMap: {},
        s: { "0": visits },
        f: {},
        b: {},
    };
    return { [filePath]: fileCoverage };
}

suite("Webview coverage helpers", () => {
    test("getWebviewCoverage reads the serializable payload inside the iframe context", async () => {
        const expected = createCoverageData("/workspace/executionPlanGraph.tsx", 1);
        const iframe = {
            owner: () => ({
                evaluate: async (callback: (element: HTMLIFrameElement) => CoverageMapData) =>
                    callback({
                        contentWindow: { __coverage__: expected },
                    } as unknown as HTMLIFrameElement),
            }),
        } as unknown as FrameLocator;

        expect(await getWebviewCoverage(iframe)).to.deep.equal(expected);
    });

    test("mergeCoverageData accumulates visits for the same instrumented file", () => {
        const filePath = "/workspace/executionPlanGraph.tsx";

        const result = mergeCoverageData(
            createCoverageData(filePath, 2),
            createCoverageData(filePath, 3),
        );

        expect(result[filePath].s["0"]).to.equal(5);
    });

    test("mergeCoverageData retains files unique to each test run", () => {
        const firstFile = "/workspace/executionPlanGraph.tsx";
        const secondFile = "/workspace/properties.tsx";

        const result = mergeCoverageData(
            createCoverageData(firstFile, 1),
            createCoverageData(secondFile, 1),
        );

        expect(Object.keys(result)).to.have.members([firstFile, secondFile]);
    });
});
