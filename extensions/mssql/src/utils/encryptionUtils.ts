/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";

const encryptionAlgorithm = "aes-256-gcm";
const encryptionKeyLength = 32;
const initializationVectorLength = 12;

export interface EncryptedData {
    version: 1;
    algorithm: typeof encryptionAlgorithm;
    iv: string;
    authTag: string;
    ciphertext: string;
}

export function generateEncryptionKey(): string {
    return crypto.randomBytes(encryptionKeyLength).toString("base64");
}

export function encryptData(data: string, key: string): EncryptedData {
    const encryptionKey = getEncryptionKeyBuffer(key);
    const initializationVector = crypto.randomBytes(initializationVectorLength);
    const cipher = crypto.createCipheriv(encryptionAlgorithm, encryptionKey, initializationVector);
    const ciphertext = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);

    return {
        version: 1,
        algorithm: encryptionAlgorithm,
        iv: initializationVector.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
    };
}

export function decryptData(encryptedData: EncryptedData, key: string): string {
    if (encryptedData.version !== 1 || encryptedData.algorithm !== encryptionAlgorithm) {
        throw new Error("Unsupported encrypted payload.");
    }

    const decipher = crypto.createDecipheriv(
        encryptionAlgorithm,
        getEncryptionKeyBuffer(key),
        Buffer.from(encryptedData.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(encryptedData.authTag, "base64"));

    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(encryptedData.ciphertext, "base64")),
        decipher.final(),
    ]);

    return plaintext.toString("utf8");
}

function getEncryptionKeyBuffer(key: string): Buffer {
    const keyBuffer = Buffer.from(key, "base64");
    if (keyBuffer.length !== encryptionKeyLength) {
        throw new Error("Invalid encryption key length.");
    }

    return keyBuffer;
}
