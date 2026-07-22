/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { projectLogContent } from "../../src/webviews/pages/RunbookStudio/logViewProjection";

suite("Runbook log view projection", () => {
    test("formats a one-line deployment report as readable XML", () => {
        const projected = projectLogContent(
            '<?xml version="1.0"?><DeploymentReport><Alerts><Alert Name="owner > login" /></Alerts><Operations><Operation Name="Create"><Item Value="dbo.Table" /></Operation></Operations></DeploymentReport>',
        );

        expect(projected.language).to.equal("xml");
        expect(projected.text).to.equal(
            [
                '<?xml version="1.0"?>',
                "<DeploymentReport>",
                "  <Alerts>",
                '    <Alert Name="owner > login" />',
                "  </Alerts>",
                "  <Operations>",
                '    <Operation Name="Create">',
                '      <Item Value="dbo.Table" />',
                "    </Operation>",
                "  </Operations>",
                "</DeploymentReport>",
            ].join("\n"),
        );
        expect(projected.lineCount).to.equal(11);
    });

    test("pretty-prints JSON", () => {
        const projected = projectLogContent('{"status":"ok","count":2}');

        expect(projected).to.deep.equal({
            language: "json",
            text: ["{", '  "status": "ok",', '  "count": 2', "}"].join("\n"),
            lineCount: 4,
        });
    });

    test("preserves malformed XML exactly as text", () => {
        const raw = "  <root><child></root>  ";
        expect(projectLogContent(raw)).to.deep.equal({
            language: "text",
            text: raw,
            lineCount: 1,
        });
    });

    test("preserves ordinary multiline logs", () => {
        const raw = "first\r\nsecond";
        expect(projectLogContent(raw)).to.deep.equal({
            language: "text",
            text: raw,
            lineCount: 2,
        });
    });
});
