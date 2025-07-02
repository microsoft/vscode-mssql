/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "path";
import fs from "fs";
import { FrameLocator } from "@playwright/test";

const istanbulCLIOutput = path.join(process.cwd(), "coverage", "views-coverage");

export async function writeCoverage(iframe: FrameLocator, testname: string) {
    // Get the HTML evaluate of the iframe
    const iframeContentWindow = await iframe
        .owner()
        .evaluate((el) => (el as HTMLIFrameElement).contentWindow);

    if (iframeContentWindow) {
        // Get coverage from window
        const coverage = (iframeContentWindow as any).__coverage__;

        // Ensure coverage data exists before writing
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
                    const existingCoverage = JSON.parse(fs.readFileSync(coverageFilePath, "utf-8"));
                    mergedCoverage = { ...existingCoverage, ...coverage };
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
    } else {
        console.error("Failed to get the iframe element.");
    }
}
