/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from "sinon";
import sinonChai from "sinon-chai";
import * as chai from "chai";
import { expect } from "chai";
import * as cp from "child_process";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { validateExtractedBinaries } from "../../src/languageservice/signatureVerifier";
import { Runtime } from "../../src/models/platform";
import { Logger } from "../../src/models/logger";

chai.use(sinonChai);

// Representative valid PowerShell Get-AuthenticodeSignature output (Status 0 = Valid).
const VALID_PS_OUTPUT = JSON.stringify({
    Status: 0,
    StatusMessage: "Signature verified.",
    SignerCertificate: {
        Subject: "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US",
        Thumbprint: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    },
});

// PowerShell output with Status 4 = HashMismatch.
const HASH_MISMATCH_PS_OUTPUT = JSON.stringify({
    Status: 4,
    StatusMessage: "HashMismatch",
    SignerCertificate: {
        Subject: "CN=Microsoft Corporation, O=Microsoft Corporation",
        Thumbprint: "ABCDEF1234567890ABCDEF1234567890ABCDEF12",
    },
});

// PowerShell output for an unsigned file (Status 5 = NotSigned).
const NOT_SIGNED_PS_OUTPUT = JSON.stringify({
    Status: 5,
    StatusMessage: "NotSigned",
    SignerCertificate: null,
});

// PowerShell output with wrong publisher.
const WRONG_PUBLISHER_PS_OUTPUT = JSON.stringify({
    Status: 0,
    StatusMessage: "Signature verified.",
    SignerCertificate: {
        Subject: "CN=Evil Corp, O=Evil Corp, L=Somewhere, C=US",
        Thumbprint: "DEADBEEF",
    },
});

suite("SignatureVerifier Tests", () => {
    let sandbox: sinon.SinonSandbox;
    let execFileStub: sinon.SinonStub;
    let testLogger: sinon.SinonStubbedInstance<Logger>;
    let tempDir: string;

    setup(async () => {
        sandbox = sinon.createSandbox();
        execFileStub = sandbox.stub(cp, "execFile");
        testLogger = sandbox.createStubInstance(Logger);
        testLogger.appendLine.returns();
        testLogger.logDebug.returns();

        // Create a temp directory with placeholder binary files.
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "sts-sig-test-"));
        await fs.writeFile(path.join(tempDir, "MicrosoftSqlToolsServiceLayer.exe"), "placeholder");
        await fs.writeFile(
            path.join(tempDir, "SqlToolsResourceProviderService.exe"),
            "placeholder",
        );
        await fs.writeFile(path.join(tempDir, "MicrosoftSqlToolsCredentials.exe"), "placeholder");
        await fs.writeFile(path.join(tempDir, "MicrosoftSqlToolsServiceLayer"), "placeholder");
        await fs.writeFile(path.join(tempDir, "SqlToolsResourceProviderService"), "placeholder");
    });

    teardown(async () => {
        sandbox.restore();
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
            // best effort
        }
    });

    suite("Windows validation", () => {
        test("happy path: all binaries present and valid signatures pass", async () => {
            // All execFile calls return valid signature JSON.
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, VALID_PS_OUTPUT, "");
            });

            await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);

            // 3 binaries × 1 powershell call each = 3 calls total.
            expect(execFileStub.callCount).to.equal(3);
        });

        test("Windows ARM64 is also validated with PowerShell", async () => {
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, VALID_PS_OUTPUT, "");
            });

            await validateExtractedBinaries(tempDir, Runtime.Windows_ARM64, testLogger);

            expect(execFileStub).to.have.been.called;
            // Verify powershell was invoked, not codesign.
            expect(execFileStub.firstCall.args[0]).to.equal("powershell");
        });

        test("calls powershell with -NoProfile -NonInteractive flags", async () => {
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, VALID_PS_OUTPUT, "");
            });

            await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);

            const args: string[] = execFileStub.firstCall.args[1];
            expect(args).to.include("-NoProfile");
            expect(args).to.include("-NonInteractive");
        });

        test("invalid signature (HashMismatch) throws an error", async () => {
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, HASH_MISMATCH_PS_OUTPUT, "");
            });

            try {
                await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("Signature is not valid");
                expect(err.message).to.include("MicrosoftSqlToolsServiceLayer.exe");
            }
        });

        test("not signed file throws an error", async () => {
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, NOT_SIGNED_PS_OUTPUT, "");
            });

            try {
                await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("Signature is not valid");
            }
        });

        test("wrong publisher throws even when Status is Valid", async () => {
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, WRONG_PUBLISHER_PS_OUTPUT, "");
            });

            try {
                await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("expected publisher");
                expect(err.message).to.include("Microsoft Corporation");
            }
        });

        test("Status string 'Valid' is also accepted", async () => {
            const stringStatusOutput = JSON.stringify({
                Status: "Valid",
                StatusMessage: "Signature verified.",
                SignerCertificate: {
                    Subject:
                        "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US",
                    Thumbprint: "ABCDEF",
                },
            });
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, stringStatusOutput, "");
            });

            await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);
        });

        test("validation succeeds when no thumbprint is pinned (expectedThumbprint is undefined)", async () => {
            // No binaries in the current list have expectedThumbprint set.
            // This test confirms that when thumbprint pinning is not configured, the signer
            // identity check (CN= subject) alone is sufficient and no false-positive occurs.
            // TODO: Add a dedicated thumbprint-mismatch test once thumbprints are pinned in
            //       the binary list (see the TODO comment in signatureVerifier.ts).
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                callback(null, VALID_PS_OUTPUT, "");
            });

            await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);
            // No error thrown — publisher check passed, thumbprint check skipped.
        });
    });

    suite("macOS validation", () => {
        setup(async () => {
            // macOS binaries don't have .exe extension — already created in parent setup.
        });

        test("happy path: all macOS binaries present and valid signatures pass", async () => {
            // First call per binary = codesign --verify (exit 0 = success via null error).
            // Second call per binary = codesign -d (returns Authority line in stderr).
            let callIndex = 0;
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                if (callIndex % 2 === 0) {
                    // codesign --verify: success
                    callback(null, "", "");
                } else {
                    // codesign -d: realistic output with full Developer ID cert name
                    callback(
                        null,
                        "",
                        "Authority=Developer ID Application: Microsoft Corporation (UBF8T346G9)\nAuthority=Developer ID Certification Authority\nAuthority=Apple Root CA\nTeamIdentifier=UBF8T346G9",
                    );
                }
                callIndex++;
            });

            await validateExtractedBinaries(tempDir, Runtime.OSX, testLogger);

            // 2 binaries × 2 codesign calls = 4 calls total.
            expect(execFileStub.callCount).to.equal(4);
        });

        test("macOS ARM64 is also validated with codesign", async () => {
            let callIndex = 0;
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                if (callIndex % 2 === 0) {
                    callback(null, "", "");
                } else {
                    callback(
                        null,
                        "",
                        "Authority=Developer ID Application: Microsoft Corporation (UBF8T346G9)",
                    );
                }
                callIndex++;
            });

            await validateExtractedBinaries(tempDir, Runtime.OSX_ARM64, testLogger);

            expect(execFileStub).to.have.been.called;
            expect(execFileStub.firstCall.args[0]).to.equal("codesign");
        });

        test("codesign --verify failure throws", async () => {
            execFileStub.callsFake((_file, args: string[], _opts, callback) => {
                if (args.includes("--verify")) {
                    const err = new Error("code object is not signed at all") as any;
                    err.code = 1;
                    callback(err, "", "");
                } else {
                    callback(
                        null,
                        "",
                        "Authority=Developer ID Application: Microsoft Corporation (UBF8T346G9)",
                    );
                }
            });

            try {
                await validateExtractedBinaries(tempDir, Runtime.OSX, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("Signature verification failed");
            }
        });

        test("wrong publisher (no matching Authority) throws", async () => {
            let callIndex = 0;
            execFileStub.callsFake((_file, _args, _opts, callback) => {
                if (callIndex % 2 === 0) {
                    callback(null, "", "");
                } else {
                    callback(null, "", "Authority=Evil Corp");
                }
                callIndex++;
            });

            try {
                await validateExtractedBinaries(tempDir, Runtime.OSX, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("expected publisher");
                expect(err.message).to.include("Microsoft Corporation");
            }
        });
    });

    suite("Linux validation", () => {
        test("Linux skips validation and logs a warning", async () => {
            await validateExtractedBinaries(tempDir, Runtime.Linux, testLogger);

            expect(execFileStub).not.to.have.been.called;
            expect(testLogger.appendLine).to.have.been.calledWithMatch(/WARN/);
            expect(testLogger.appendLine).to.have.been.calledWithMatch(/Linux/);
        });

        test("Linux ARM64 also skips validation", async () => {
            await validateExtractedBinaries(tempDir, Runtime.Linux_ARM64, testLogger);

            expect(execFileStub).not.to.have.been.called;
        });
    });

    suite("Missing binary", () => {
        test("missing required binary throws before calling execFile", async () => {
            // Remove a required Windows binary.
            await fs.rm(path.join(tempDir, "MicrosoftSqlToolsServiceLayer.exe"));

            try {
                await validateExtractedBinaries(tempDir, Runtime.Windows_64, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("was not found");
                expect(err.message).to.include("MicrosoftSqlToolsServiceLayer.exe");
            }

            // execFile should not have been called since binary was missing.
            expect(execFileStub).not.to.have.been.called;
        });

        test("missing macOS binary throws", async () => {
            await fs.rm(path.join(tempDir, "MicrosoftSqlToolsServiceLayer"));

            try {
                await validateExtractedBinaries(tempDir, Runtime.OSX, testLogger);
                expect.fail("Expected an error to be thrown");
            } catch (err: any) {
                expect(err.message).to.include("was not found");
                expect(err.message).to.include("MicrosoftSqlToolsServiceLayer");
            }
        });
    });
});
