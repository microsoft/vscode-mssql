/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// taken from mxschimtt: https://github.com/mxschmitt/playwright-test-coverage/blob/main/e2e/baseFixtures.ts

import * as fs from "fs";
import * as path from "path";
import { test as baseTest, BrowserContext } from "@playwright/test";

const istanbulCLIOutput = path.join(process.cwd(), ".nyc_output");

export function uuid(): string {
    return crypto.randomUUID();
}

export const test = baseTest.extend<{
    context: BrowserContext;
}>({
    context: async ({ context }, use) => {
        await context.addInitScript(() =>
            window.addEventListener("beforeunload", () => {
                (window as any).collectIstanbulCoverage(
                    JSON.stringify((window as any).__coverage__),
                );
            }),
        );
        await fs.promises.mkdir(istanbulCLIOutput, { recursive: true });
        await context.exposeFunction("collectIstanbulCoverage", (coverageJSON: string) => {
            if (coverageJSON) {
                fs.writeFileSync(
                    path.join(istanbulCLIOutput, `playwright_coverage_${uuid()}.json`),
                    coverageJSON,
                );
            }
        });
        await use(context);
        for (const page of context.pages()) {
            await page.evaluate(() =>
                (window as any).collectIstanbulCoverage(
                    JSON.stringify((window as any).__coverage__),
                ),
            );
        }
    },
});

export const expect = test.expect;
