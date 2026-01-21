/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

"use strict";

import "ts-node/register";
import "source-map-support/register";

import * as Mocha from "mocha";
import * as baseConfig from "@istanbuljs/nyc-config-typescript";
import * as glob from "glob";
import * as path from "path";

const NYC = require("nyc");

const tty = require("tty");
if (!tty.getWindowSize) {
    tty.getWindowSize = (): number[] => {
        return [80, 75];
    };
}

export async function run(): Promise<void> {
    const testsRoot = path.resolve(__dirname, "..");

    console.log("🚀 Starting Data Workspace Test Suite");
    console.log("=".repeat(60));

    const nyc = new NYC({
        ...baseConfig,
        cwd: path.join(__dirname, "..", "..", ".."),
        reporter: ["text-summary", "html", "lcov", "cobertura"],
        all: true,
        silent: true,
        instrument: true,
        hookRequire: true,
        hookRunInContext: true,
        hookRunInThisContext: true,
        include: ["out/**/*.js"],
        exclude: ["out/test/**", "**/node_modules/**"],
        tempDir: "./coverage/.nyc_output",
    });

    await nyc.reset();
    await nyc.wrap();

    return new Promise<void>((resolve, reject) => {
        const mocha = new Mocha({
            ui: "tdd",
            timeout: 10000,
        });

        const files = glob.sync("**/**.test.js", { cwd: testsRoot });

        files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

        try {
            mocha.run((failures) => {
                if (failures > 0) {
                    reject(new Error(`${failures} tests failed.`));
                } else {
                    resolve();
                }
            });
        } catch (err) {
            console.error(err);
            reject(err);
        }
    });
}
