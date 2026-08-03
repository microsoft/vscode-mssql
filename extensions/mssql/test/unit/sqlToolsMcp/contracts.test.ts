/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { ErrorCodes } from "vscode-jsonrpc/node";
import {
    BridgeErrorCode,
    BridgeRequestError,
    bridgeResponseError,
} from "../../../src/sqlToolsMcp/contracts";

suite("SQL Tools MCP bridge contracts", () => {
    test("maps bridge request errors to JSON-RPC response errors", () => {
        const error = bridgeResponseError(
            new BridgeRequestError(BridgeErrorCode.NotReady, "Not ready.", true),
        );

        expect(error.code).to.equal(ErrorCodes.ServerNotInitialized);
        expect(error.message).to.equal("Not ready.");
        expect(error.data).to.deep.equal({
            errorCode: BridgeErrorCode.NotReady,
            retryable: true,
        });
    });

    test("maps expected bridge error categories to stable JSON-RPC codes", () => {
        const cases: [BridgeErrorCode, number][] = [
            [BridgeErrorCode.InvalidRequest, ErrorCodes.InvalidRequest],
            [BridgeErrorCode.ProtocolMismatch, ErrorCodes.InvalidRequest],
            [BridgeErrorCode.NotFound, ErrorCodes.InvalidParams],
            [BridgeErrorCode.NotReady, ErrorCodes.ServerNotInitialized],
            [BridgeErrorCode.Cancelled, -32800],
            [BridgeErrorCode.InternalError, ErrorCodes.InternalError],
        ];

        for (const [bridgeErrorCode, jsonRpcErrorCode] of cases) {
            const error = bridgeResponseError(new BridgeRequestError(bridgeErrorCode, "failed"));

            expect(error.code).to.equal(jsonRpcErrorCode);
            expect(error.data).to.deep.equal({
                errorCode: bridgeErrorCode,
                retryable: false,
            });
        }
    });

    test("hides unexpected error details behind internal bridge failure", () => {
        const error = bridgeResponseError(new Error("raw failure"));

        expect(error.code).to.equal(ErrorCodes.InternalError);
        expect(error.message).to.equal("SQL Tools MCP bridge request failed.");
        expect(error.data).to.deep.equal({
            errorCode: BridgeErrorCode.InternalError,
            retryable: false,
        });
    });
});
