/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { EvidenceExportArtifact } from "../evidenceExport";
import type { RbsEvidenceExportFormat } from "../../sharedInterfaces/runbookStudio";

const OUTPUT_NAMES: Record<RbsEvidenceExportFormat, string> = {
    json: "evidence.machine.json",
    junit: "evidence.junit.xml",
    sarif: "evidence.sarif",
    markdown: "evidence.md",
};

/**
 * Commit fixed-name machine outputs with create-new semantics. Evidence files
 * are renamed first and run-summary.json is the final completion marker, so a
 * reader never observes a summary for a partially written export set.
 */
export function writeHeadlessRunOutputs(
    outputDirectory: string,
    summary: Record<string, unknown>,
    exports: Partial<Record<RbsEvidenceExportFormat, EvidenceExportArtifact>> | undefined,
): void {
    const directory = path.resolve(outputDirectory);
    fs.mkdirSync(directory, { recursive: true });
    const directoryStat = fs.lstatSync(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
        throw new Error("headless output directory is unsafe");
    }
    const entries: Array<{ target: string; content: string }> = [];
    for (const format of ["json", "junit", "sarif", "markdown"] as const) {
        const artifact = exports?.[format];
        if (artifact) {
            entries.push({
                target: path.join(directory, OUTPUT_NAMES[format]),
                content: artifact.content,
            });
        }
    }
    entries.push({
        target: path.join(directory, "run-summary.json"),
        content: JSON.stringify(summary, undefined, 2) + "\n",
    });
    if (entries.some((entry) => fs.existsSync(entry.target))) {
        throw new Error("headless output already exists");
    }

    const staged: Array<{ target: string; temporary: string }> = [];
    const committed: string[] = [];
    try {
        for (const entry of entries) {
            const temporary = path.join(
                directory,
                `.${path.basename(entry.target)}.${process.pid}.${crypto.randomUUID()}.tmp`,
            );
            const descriptor = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(descriptor, entry.content, "utf8");
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            staged.push({ target: entry.target, temporary });
        }
        for (const entry of staged) {
            fs.renameSync(entry.temporary, entry.target);
            committed.push(entry.target);
        }
    } catch (error) {
        for (const entry of staged) {
            fs.rmSync(entry.temporary, { force: true });
        }
        for (const target of committed) {
            fs.rmSync(target, { force: true });
        }
        throw error;
    }
}
