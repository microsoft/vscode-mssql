/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";

suite("Live query statistics preview manifest", () => {
    const { contributes } = JSON.parse(
        fs.readFileSync(path.join(__dirname, "..", "..", "..", "package.json"), "utf8"),
    );
    const previewGate = "mssql.preview.liveQueryStatisticsEnabled";
    const commands = ["mssql.enableLiveQueryStatistics", "mssql.disableLiveQueryStatistics"];

    test("defaults to the umbrella and permits explicit true and false overrides", () => {
        const setting = contributes.configuration.properties["mssql.preview.liveQueryStatistics"];

        expect(setting.default).to.be.null;
        expect(setting.type).to.have.members(["boolean", "null"]);
        expect(setting.scope).to.equal("application");
    });

    test("gates command enablement, the command palette, and editor toolbar on the preview", () => {
        for (const command of commands) {
            expect(
                contributes.commands.find((entry: { command: string }) => entry.command === command)
                    ?.enablement,
            ).to.equal(previewGate);
            expect(
                contributes.menus.commandPalette.find(
                    (entry: { command: string }) => entry.command === command,
                )?.when,
            ).to.equal(previewGate);
            const toolbarCondition = contributes.menus["editor/title"].find(
                (entry: { command: string }) => entry.command === command,
            )?.when;
            expect(toolbarCondition?.startsWith(`${previewGate} && `)).to.be.true;
        }
    });
});
