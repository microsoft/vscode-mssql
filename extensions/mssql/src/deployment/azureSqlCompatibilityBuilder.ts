/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from "node:path";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import * as vscode from "vscode";
import * as yauzl from "yauzl";
import { DOMParser } from "@xmldom/xmldom";
import { NetCoreTool } from "../databaseProjects/tools/netcoreTool";
import { LocalToCloud } from "../constants/locConstants";
import { LocalDatabaseCompatibilityDiagnostic } from "../sharedInterfaces/azureSqlDatabase";

export interface AzureSqlCompatibilityBuildResult {
    diagnostics: LocalDatabaseCompatibilityDiagnostic[];
    packagePath?: string;
    objectsValidated?: number;
    schemaObjects?: string[];
    errorMessage?: string;
}

export function parseCompatibilityDiagnostics(
    output: string,
    projectDirectory: string,
): LocalDatabaseCompatibilityDiagnostic[] {
    const diagnostics = new Map<string, LocalDatabaseCompatibilityDiagnostic>();
    for (const line of output.split(/\r?\n/)) {
        const match = line.match(
            /^(.*?)\s*:\s*(?:Build\s+)?(error|warning)\s+([A-Z]+\d+)\s*:\s*(.*?)(?:\s+\[[^\]]+\.sqlproj\])?$/i,
        );
        if (!match) {
            continue;
        }
        const [, location, severity, code, message] = match;
        const fileLocation = location.match(/^(.*?)(?:\((\d+)(?:,\d+)?(?:,\d+,\d+)?\))?$/);
        const file = fileLocation?.[1].trim();
        const diagnostic: LocalDatabaseCompatibilityDiagnostic = {
            severity: severity.toLowerCase() === "error" ? "error" : "warning",
            category: ["SQL71501", "SQL71502", "SQL71561", "SQL71562"].includes(code.toUpperCase())
                ? "dependency"
                : /^SQL7/i.test(code)
                  ? "compatibility"
                  : "tooling",
            code: code.toUpperCase(),
            message,
            ...(file && file !== "MSBUILD" ? { file: path.relative(projectDirectory, file) } : {}),
            ...(fileLocation?.[2] ? { line: Number(fileLocation[2]) } : {}),
        };
        diagnostics.set(JSON.stringify(diagnostic), diagnostic);
    }
    return [...diagnostics.values()];
}

export function getCompatibilityModelObjects(xml: string): string[] {
    const document = new DOMParser({
        onError: (level, message) => {
            if (level !== "warning") {
                throw new Error(message);
            }
        },
    }).parseFromString(xml, "text/xml");
    const model = document.getElementsByTagName("Model")[0];
    if (!model) {
        throw new Error(LocalToCloud.modelMissing);
    }
    // Include top-level named schema objects, not columns, constraints, or database settings.
    const types = new Set([
        "SqlTable",
        "SqlView",
        "SqlProcedure",
        "SqlScalarFunction",
        "SqlInlineTableValuedFunction",
        "SqlMultiStatementTableValuedFunction",
        "SqlSequence",
        "SqlSynonym",
        "SqlUserDefinedDataType",
        "SqlTableType",
        "SqlUserDefinedType",
        "SqlAssembly",
        "SqlDmlTrigger",
    ]);
    const objects: string[] = [];
    const elements = model.getElementsByTagName("Element");
    for (let index = 0; index < elements.length; index++) {
        const element = elements[index];
        const name = element.getAttribute("Name");
        if (element.parentNode === model && name && types.has(element.getAttribute("Type") ?? "")) {
            objects.push(name);
        }
    }
    return objects;
}

async function readPackageModel(packagePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
        yauzl.open(packagePath, { lazyEntries: true }, (error, zip) => {
            if (error || !zip) {
                reject(error ?? new Error(LocalToCloud.packageMissing));
                return;
            }
            const fail = (failure: Error) => {
                zip.close();
                reject(failure);
            };
            zip.on("error", fail);
            zip.on("end", () => reject(new Error(LocalToCloud.modelMissing)));
            zip.on("entry", (entry: yauzl.Entry) => {
                if (entry.fileName !== "model.xml") {
                    zip.readEntry();
                    return;
                }
                zip.openReadStream(entry, (streamError, stream) => {
                    if (streamError || !stream) {
                        fail(streamError ?? new Error(LocalToCloud.modelMissing));
                        return;
                    }
                    const chunks: Buffer[] = [];
                    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
                    stream.on("error", fail);
                    stream.on("end", () => {
                        zip.close();
                        resolve(Buffer.concat(chunks).toString("utf8"));
                    });
                });
            });
            zip.readEntry();
        });
    });
}

export class AzureSqlCompatibilityBuilder {
    constructor(private readonly output: vscode.OutputChannel) {}

    public async build(
        projectPath: string,
        signal: AbortSignal,
        onCheckingPackage?: () => void,
    ): Promise<AzureSqlCompatibilityBuildResult> {
        const tool = new NetCoreTool(this.output);
        await tool.verifyNetCoreInstallation();
        signal.throwIfAborted();
        const directory = await fs.realpath(path.dirname(projectPath));
        const outputDirectory = path.join(directory, "package");
        const executable = path.join(
            tool.netcoreInstallLocation,
            process.platform === "win32" ? "dotnet.exe" : "dotnet",
        );
        const args = [
            "build",
            projectPath,
            "--nologo",
            "--verbosity",
            "normal",
            "--output",
            outputDirectory,
            "/nr:false",
            "/m:1",
        ];
        this.output.appendLine([executable, ...args].join(" "));
        const { code, output } = await new Promise<{ code: number | null; output: string }>(
            (resolve, reject) => {
                const child = spawn(executable, args, {
                    cwd: directory,
                    shell: false,
                    windowsHide: true,
                    env: {
                        ...process.env,
                        DOTNET_CLI_UI_LANGUAGE: "en-US",
                        VSLANG: "1033",
                        DOTNET_CLI_TELEMETRY_OPTOUT: "1",
                    },
                });
                const chunks: string[] = [];
                let outputBytes = 0;
                let spawnError: Error | undefined;
                const abort = () => {
                    child.kill();
                };
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) {
                    abort();
                }
                const append = (text: string) => {
                    if (spawnError) {
                        return;
                    }
                    outputBytes += Buffer.byteLength(text, "utf8");
                    if (outputBytes > 10 * 1024 * 1024) {
                        spawnError = new Error(LocalToCloud.buildOutputTooLarge);
                        child.kill();
                        return;
                    }
                    chunks.push(text);
                    this.output.append(text);
                };
                child.stdout.setEncoding("utf8").on("data", append);
                child.stderr.setEncoding("utf8").on("data", append);
                child.on("error", (error) => {
                    spawnError = error;
                });
                child.on("close", (code) => {
                    signal.removeEventListener("abort", abort);
                    if (spawnError) {
                        reject(spawnError);
                    } else {
                        resolve({ code, output: chunks.join("") });
                    }
                });
            },
        );
        signal.throwIfAborted();
        const diagnostics = parseCompatibilityDiagnostics(output, directory);
        if (code !== 0 || diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
            if (!diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
                diagnostics.push({
                    severity: "error",
                    category: "tooling",
                    code: "BUILD",
                    message: output.trim() || LocalToCloud.buildFailed,
                });
            }
            return { diagnostics, errorMessage: LocalToCloud.buildFailed };
        }
        onCheckingPackage?.();
        const packagePath = path.join(
            outputDirectory,
            `${path.basename(projectPath, ".sqlproj")}.dacpac`,
        );
        await fs.access(packagePath);
        const schemaObjects = getCompatibilityModelObjects(await readPackageModel(packagePath));
        return {
            diagnostics,
            packagePath,
            objectsValidated: schemaObjects.length,
            schemaObjects,
        };
    }
}
