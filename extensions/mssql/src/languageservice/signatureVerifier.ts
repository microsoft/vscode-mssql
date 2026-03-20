/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from "child_process";
import * as fs from "fs/promises";
import * as path from "path";
import { Runtime } from "../models/platform";
import { ILogger } from "../models/interfaces";

export interface RequiredSignedBinary {
    fileName: string;
    expectedPublisher: string; // e.g. "Microsoft Corporation"
    expectedThumbprint?: string; // optional, for stricter pinning
}

// TODO: Add expectedThumbprint for stricter pinning once the production thumbprint is confirmed.
// To retrieve the thumbprint from a known-good binary, run in PowerShell:
//   $sig = Get-AuthenticodeSignature "path\to\MicrosoftSqlToolsServiceLayer.exe"
//   $sig.SignerCertificate.Thumbprint
//   $sig.SignerCertificate.Subject
const WINDOWS_REQUIRED_BINARIES: RequiredSignedBinary[] = [
    { fileName: "MicrosoftSqlToolsServiceLayer.exe", expectedPublisher: "Microsoft Corporation" },
    {
        fileName: "SqlToolsResourceProviderService.exe",
        expectedPublisher: "Microsoft Corporation",
    },
    { fileName: "MicrosoftSqlToolsCredentials.exe", expectedPublisher: "Microsoft Corporation" },
];

const MACOS_REQUIRED_BINARIES: RequiredSignedBinary[] = [
    { fileName: "MicrosoftSqlToolsServiceLayer", expectedPublisher: "Microsoft Corporation" },
    { fileName: "SqlToolsResourceProviderService", expectedPublisher: "Microsoft Corporation" },
];

function execFilePromise(
    file: string,
    args: string[],
    timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        cp.execFile(file, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
            if (err) {
                reject(err);
            } else {
                resolve({ stdout, stderr });
            }
        });
    });
}

async function verifyWindowsBinary(
    binaryPath: string,
    binary: RequiredSignedBinary,
): Promise<void> {
    // Escape single quotes in the path for PowerShell string interpolation.
    // execFile is used (not exec) so the arguments themselves are not shell-interpolated.
    const escapedPath = binaryPath.replace(/'/g, "''");
    const psScript = `Get-AuthenticodeSignature '${escapedPath}' | ConvertTo-Json -Depth 10`;

    let stdout: string;
    try {
        ({ stdout } = await execFilePromise(
            "powershell",
            ["-NoProfile", "-NonInteractive", "-Command", psScript],
            30_000,
        ));
    } catch (err) {
        throw new Error(`Signature verification command failed for "${binary.fileName}": ${err}`);
    }

    let sigInfo: any;
    try {
        sigInfo = JSON.parse(stdout);
    } catch {
        throw new Error(
            `Failed to parse signature output for "${binary.fileName}". Output: ${stdout}`,
        );
    }

    // Status 0 maps to the AuthenticodeSignatureStatus.Valid enum value.
    // ConvertTo-Json serializes enums as integers in PowerShell 5.x; as strings in some contexts.
    const isValid = sigInfo.Status === 0 || sigInfo.Status === "Valid";
    if (!isValid) {
        throw new Error(
            `Signature is not valid for "${binary.fileName}". ` +
                `Status: ${sigInfo.Status}, Message: ${sigInfo.StatusMessage}`,
        );
    }

    // Verify the signer is the expected publisher. Checking Status alone is insufficient
    // because any trusted publisher would pass that check.
    const subject: string = sigInfo.SignerCertificate?.Subject ?? "";
    if (!subject.includes(`CN=${binary.expectedPublisher}`)) {
        throw new Error(
            `Binary "${binary.fileName}" was not signed by the expected publisher. ` +
                `Expected CN=${binary.expectedPublisher}, got Subject: "${subject}"`,
        );
    }

    if (binary.expectedThumbprint) {
        const thumbprint: string = (sigInfo.SignerCertificate?.Thumbprint ?? "").toLowerCase();
        if (thumbprint !== binary.expectedThumbprint.toLowerCase()) {
            throw new Error(
                `Thumbprint mismatch for "${binary.fileName}". ` +
                    `Expected: ${binary.expectedThumbprint}, got: ${thumbprint}`,
            );
        }
    }
}

async function verifyMacOSBinary(binaryPath: string, binary: RequiredSignedBinary): Promise<void> {
    // Step 1: verify the signature is structurally valid.
    try {
        await execFilePromise("codesign", ["--verify", "--verbose=2", binaryPath], 30_000);
    } catch (err) {
        throw new Error(`Signature verification failed for "${binary.fileName}": ${err}`);
    }

    // Step 2: dump the signing info and verify the signer identity.
    // codesign -d writes to stderr, so capture both stdout and stderr.
    let output: string;
    try {
        const result = await execFilePromise("codesign", ["-d", "--verbose=2", binaryPath], 30_000);
        output = result.stdout + result.stderr;
    } catch (err) {
        // codesign -d may exit non-zero for some binary types; capture any available output.
        const nodeErr = err as NodeJS.ErrnoException & { stderr?: string; stdout?: string };
        output = (nodeErr.stdout ?? "") + (nodeErr.stderr ?? "");
        if (!output) {
            throw new Error(`Failed to read signature info for "${binary.fileName}": ${err}`);
        }
    }

    // Check that at least one "Authority=..." line contains the expected publisher name.
    // The real codesign output includes the full certificate name, e.g.:
    //   "Authority=Developer ID Application: Microsoft Corporation (UBF8T346G9)"
    // so we match by substring rather than an exact Authority= prefix.
    const hasMatchingAuthority = output
        .split(/\r?\n/)
        .filter((line) => line.trim().startsWith("Authority="))
        .some((line) => line.includes(binary.expectedPublisher));

    if (!hasMatchingAuthority) {
        throw new Error(
            `Binary "${binary.fileName}" was not signed by the expected publisher. ` +
                `Expected an Authority line containing "${binary.expectedPublisher}". Signature info: ${output}`,
        );
    }
}

/**
 * Validates Authenticode signatures of extracted STS binaries before the service is launched.
 *
 * - Windows: shells out to PowerShell's Get-AuthenticodeSignature.
 * - macOS: uses the codesign utility.
 * - Linux: STS ships as .NET assemblies without OS-level Authenticode support; validation is
 *   skipped with a logged warning. (TODO: consider strong-name or hash-based verification for Linux.)
 *
 * Throws if any required binary is missing or fails signature validation.
 */
export async function validateExtractedBinaries(
    installDir: string,
    runtime: Runtime,
    logger: ILogger,
): Promise<void> {
    const isWindows = runtime === Runtime.Windows_64 || runtime === Runtime.Windows_ARM64;
    const isMacOS = runtime === Runtime.OSX || runtime === Runtime.OSX_ARM64;

    if (!isWindows && !isMacOS) {
        // Linux: .NET DLLs do not support OS-level Authenticode verification.
        // Skipping signature validation on this platform.
        logger.appendLine(
            "[WARN] Authenticode signature validation is not supported on Linux. " +
                "Skipping binary signature checks.",
        );
        return;
    }

    const binaries = isWindows ? WINDOWS_REQUIRED_BINARIES : MACOS_REQUIRED_BINARIES;
    for (const binary of binaries) {
        const binaryPath = path.join(installDir, binary.fileName);

        // Verify the binary exists before attempting signature check.
        try {
            await fs.access(binaryPath);
        } catch {
            throw new Error(
                `Required binary "${binary.fileName}" was not found in "${installDir}". ` +
                    `The downloaded package may be incomplete or corrupted.`,
            );
        }

        if (isWindows) {
            await verifyWindowsBinary(binaryPath, binary);
        } else {
            await verifyMacOSBinary(binaryPath, binary);
        }

        logger.appendLine(`Signature verified: ${binary.fileName}`);
    }
}
