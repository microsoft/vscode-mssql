/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "path";
import * as fs from "fs";
import type { FrameLocator } from "@playwright/test";
import type { CoverageMapData } from "istanbul-lib-coverage";
import { mergeCoverageData } from "./coverageMerge";

const istanbulCLIOutput = path.join(process.cwd(), "coverage", "webviews-coverage");

export function getWebviewCoverage(iframe: FrameLocator): Promise<CoverageMapData | undefined> {
    return iframe.owner().evaluate((element) => {
        const contentWindow = (element as HTMLIFrameElement).contentWindow as
            | (Window & { __coverage__?: CoverageMapData })
            | null;
        return contentWindow?.__coverage__;
    });
}

export async function writeCoverage(iframe: FrameLocator, testname: string) {
    const coverage = await getWebviewCoverage(iframe);

    if (coverage) {
        if (!fs.existsSync(istanbulCLIOutput)) {
            fs.mkdirSync(istanbulCLIOutput, { recursive: true });
            console.log(`Created directory: ${istanbulCLIOutput}`);
        }

        const coverageFilePath = path.join(
            istanbulCLIOutput,
            `playwright_coverage_${testname}.json`,
        );

        let mergedCoverage = coverage;

        // If the file already exists, merge the coverage data
        if (fs.existsSync(coverageFilePath)) {
            try {
                const existingCoverage = JSON.parse(
                    fs.readFileSync(coverageFilePath, "utf-8"),
                ) as CoverageMapData;
                mergedCoverage = mergeCoverageData(existingCoverage, coverage);
            } catch (error) {
                console.error("Error reading existing coverage file:", error);
            }
        }
        const coverageJSON = JSON.stringify(mergedCoverage, null, 2);

        fs.writeFileSync(coverageFilePath, coverageJSON, "utf-8");

        console.log(`Coverage data successfully written to: ${coverageFilePath}`);
    } else {
        console.warn("No coverage data found.");
    }
}
