/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "path";
import fs from "fs";
import { FrameLocator } from "@playwright/test";

const istanbulCLIOutput = path.join(process.cwd(), "coverage", "reactviews-coverage");

export async function writeCoverage(coverageMap: Map<string, any>) {
    if (!fs.existsSync(istanbulCLIOutput)) {
        fs.mkdirSync(istanbulCLIOutput, { recursive: true });
        console.log(`Created directory: ${istanbulCLIOutput}`);
    }
    for (const [testname, coverage] of coverageMap.entries()) {
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

            const coverageJSON = JSON.stringify(coverage, null, 2);

            fs.writeFileSync(coverageFilePath, coverageJSON, "utf-8");

            console.log(`Coverage data successfully written to: ${coverageFilePath}`);
        } else {
            console.warn("No coverage data found.");
        }
    }
}

export async function getCoverageFromWebview(iframe: FrameLocator) {
    // Get the HTML evaluate of the iframe
    const iframeContentWindow = await iframe
        .owner()
        .evaluate((el) => (el as HTMLIFrameElement).contentWindow);

    if (iframeContentWindow) {
        // Get coverage from window
        const coverage = (iframeContentWindow as any).__coverage__;
        return coverage;
    } else {
        console.error("Failed to get the iframe element.");
    }
}
