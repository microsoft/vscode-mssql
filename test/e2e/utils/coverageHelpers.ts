/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import path from "path";
import fs from "fs";
import { FrameLocator } from "@playwright/test";

const istanbulCLIOutput = path.join(process.cwd(), ".nyc_output");

export async function writeCoverage(iframe: FrameLocator, testname: string) {
    const iframeWindow = iframe.locator("#active-frame");

    // Get the HTML evaluate of the iframe
    const iframeContentWindow = await iframeWindow.evaluate(
        (el) => (el as HTMLIFrameElement).contentWindow,
    );

    if (iframeContentWindow) {
        // Get coverage from window
        const coverage = (iframeContentWindow as any).__coverage__;

        // Ensure coverage data exists before writing
        if (coverage) {
            const coverageJSON = JSON.stringify(coverage, null, 2);
            const coverageFilePath = path.join(
                istanbulCLIOutput,
                `playwright_coverage_${testname}.json`,
            );

            fs.writeFileSync(coverageFilePath, coverageJSON, "utf-8");

            console.log(
                `Coverage data successfully written to: ${coverageFilePath}`,
            );
        } else {
            console.warn("No coverage data found.");
        }
    } else {
        console.error("Failed to get the iframe element.");
    }
}
