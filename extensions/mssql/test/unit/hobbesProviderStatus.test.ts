/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    parseHobbesProviderLoginFrame,
    parseHobbesProviderStatus,
} from "../../src/runbookStudio/runtime/hobbesRuntimeAdapter";

suite("hobbesProviderStatus", () => {
    test("projects the bounded active-provider readiness contract", () => {
        expect(
            parseHobbesProviderStatus({
                configured: false,
                mode: "local-bypass",
                loginRequired: true,
                provider: {
                    profileId: "github-copilot-default",
                    kind: "github-copilot",
                    label: "GitHub Copilot",
                    enabled: true,
                    ready: false,
                    reason: "Sign-in is required.",
                    supportsLogin: true,
                    ignored: "not projected",
                },
            }),
        ).to.deep.equal({
            loginRequired: true,
            provider: {
                profileId: "github-copilot-default",
                kind: "github-copilot",
                label: "GitHub Copilot",
                enabled: true,
                ready: false,
                reason: "Sign-in is required.",
                supportsLogin: true,
            },
        });
    });

    test("refuses malformed or unbounded status fields", () => {
        expect(parseHobbesProviderStatus({ loginRequired: true, provider: {} })).to.equal(
            undefined,
        );
        expect(
            parseHobbesProviderStatus({
                loginRequired: false,
                provider: {
                    profileId: "p",
                    kind: "local",
                    label: "x".repeat(257),
                    enabled: true,
                    ready: true,
                    supportsLogin: false,
                },
            }),
        ).to.equal(undefined);
    });

    test("parses only bounded device-code login data", () => {
        expect(
            parseHobbesProviderLoginFrame(
                'event: device-code\r\ndata: {"verificationUri":"https://github.com/login/device","userCode":"ABCD-1234","message":"ignored"}',
            ),
        ).to.deep.equal({
            kind: "deviceCode",
            verificationUri: "https://github.com/login/device",
            userCode: "ABCD-1234",
        });
        expect(
            parseHobbesProviderLoginFrame('event: succeeded\ndata: {"stage":"Succeeded"}'),
        ).to.deep.equal({ kind: "succeeded" });
    });

    test("ignores malformed login frames", () => {
        expect(parseHobbesProviderLoginFrame("event: failed\ndata: not-json")).to.equal(undefined);
        expect(parseHobbesProviderLoginFrame("event: pending")).to.equal(undefined);
    });
});
