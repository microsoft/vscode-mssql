/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { decryptData, encryptData, generateEncryptionKey } from "../../src/utils/encryptionUtils";

suite("encryptionUtils", () => {
    test("generateEncryptionKey should return a 32-byte base64 key", () => {
        const encryptionKey = generateEncryptionKey();

        expect(Buffer.from(encryptionKey, "base64")).to.have.lengthOf(32);
    });

    test("encryptData and decryptData should round-trip plaintext", () => {
        const encryptionKey = generateEncryptionKey();
        const plaintext = JSON.stringify({
            version: 1,
            nodes: [{ queryString: "SELECT 1", isSuccess: true }],
        });

        const encryptedData = encryptData(plaintext, encryptionKey);

        expect(decryptData(encryptedData, encryptionKey)).to.equal(plaintext);
    });

    test("decryptData should reject tampered ciphertext", () => {
        const encryptionKey = generateEncryptionKey();
        const encryptedData = encryptData("sensitive query history", encryptionKey);

        encryptedData.ciphertext = `Some tampering${encryptedData.ciphertext.slice(1)}`;

        expect(() => decryptData(encryptedData, encryptionKey)).to.throw();
    });
});
