/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { withBearerToken } from "../../../src/base/http/httpAuthentication";
import { IDownloadOptions, IHttpRequestOptions } from "../../../src/base/http/httpTypes";

describe("withBearerToken", () => {
    it("creates an authorization header", () => {
        const result = withBearerToken("token-value");

        expect(result.headers.Authorization).to.equal("Bearer token-value");
    });

    it("preserves existing headers and request options", () => {
        const controller = new AbortController();
        const options: IHttpRequestOptions = {
            headers: { "x-ms-client-request-id": "request-id" },
            signal: controller.signal,
            timeoutMs: 30_000,
        };

        const result = withBearerToken("token-value", options);

        expect(result).to.deep.equal({
            headers: {
                "x-ms-client-request-id": "request-id",
                Authorization: "Bearer token-value",
            },
            signal: controller.signal,
            timeoutMs: 30_000,
        });
    });

    it("does not mutate the supplied options or headers", () => {
        const headers = { Accept: "application/json" };
        const options = { headers, timeoutMs: 1_000 };

        const result = withBearerToken("token-value", options);

        expect(options).to.deep.equal({
            headers: { Accept: "application/json" },
            timeoutMs: 1_000,
        });
        expect(result).not.to.equal(options);
        expect(result.headers).not.to.equal(headers);
    });

    it("retains download-specific options", () => {
        const onProgress = () => undefined;
        const options: IDownloadOptions = { onProgress };

        const result = withBearerToken("token-value", options);

        expect(result.onProgress).to.equal(onProgress);
    });

    for (const token of [
        "",
        "   ",
        " token",
        "token ",
        "Bearer token",
        "bEaReR token",
        "token\rvalue",
        "token\nvalue",
    ]) {
        it(`rejects invalid token input ${JSON.stringify(token)}`, () => {
            expect(() => withBearerToken(token)).to.throw(
                TypeError,
                "Bearer token must be an unprefixed, non-empty value without whitespace padding or newlines",
            );
        });
    }

    for (const header of ["Authorization", "authorization", "AUTHORIZATION", "AuThOrIzAtIoN"]) {
        it(`rejects an existing ${header} header`, () => {
            expect(() =>
                withBearerToken("token-value", { headers: { [header]: "existing-value" } }),
            ).to.throw(TypeError, "Request options already contain an Authorization header");
        });
    }
});
