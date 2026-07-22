/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface HeadlessCliArguments {
    command?: "capabilities" | "validate" | "run";
    artifactPath?: string;
    paramsPath?: string;
    outputDirectory?: string;
    runId?: string;
    secretEnvironmentMapPath?: string;
    approvalManifestPath?: string;
    deterministicPreview: boolean;
    approvePreview: boolean;
    error?:
        | "HeadlessPreview.Usage"
        | "HeadlessPreview.OptionUnknown"
        | "HeadlessPreview.OptionDuplicate"
        | "HeadlessPreview.OptionValueRequired"
        | "HeadlessPreview.OptionConflict"
        | "HeadlessPreview.ArgumentUnexpected";
}

const COMMANDS = new Set(["capabilities", "validate", "run"]);
const VALUE_OPTIONS = new Set([
    "--params",
    "--output",
    "--run-id",
    "--secret-env-map",
    "--approval-manifest",
]);
const BOOLEAN_OPTIONS = new Set(["--json", "--deterministic-preview", "--approve-preview"]);

const ALLOWED_OPTIONS: Record<"capabilities" | "validate" | "run", ReadonlySet<string>> = {
    capabilities: new Set(["--json"]),
    validate: new Set(["--params"]),
    run: new Set([
        "--params",
        "--output",
        "--run-id",
        "--secret-env-map",
        "--approval-manifest",
        "--deterministic-preview",
        "--approve-preview",
    ]),
};

/**
 * Parse only the documented CLI surface. Errors intentionally identify the
 * contract violation without reflecting caller-controlled values.
 */
export function parseHeadlessCliArguments(values: string[]): HeadlessCliArguments {
    const result: HeadlessCliArguments = {
        deterministicPreview: false,
        approvePreview: false,
    };
    const commandValue = values[0];
    if (!commandValue || !COMMANDS.has(commandValue)) {
        result.error = "HeadlessPreview.Usage";
        return result;
    }
    const command = commandValue as HeadlessCliArguments["command"];
    result.command = command;
    const seen = new Set<string>();
    const positionals: string[] = [];
    for (let index = 1; index < values.length; index++) {
        const value = values[index];
        if (!value.startsWith("--")) {
            positionals.push(value);
            continue;
        }
        if (!VALUE_OPTIONS.has(value) && !BOOLEAN_OPTIONS.has(value)) {
            result.error = "HeadlessPreview.OptionUnknown";
            return result;
        }
        if (!ALLOWED_OPTIONS[command!].has(value)) {
            result.error = "HeadlessPreview.OptionUnknown";
            return result;
        }
        if (seen.has(value)) {
            result.error = "HeadlessPreview.OptionDuplicate";
            return result;
        }
        seen.add(value);
        if (VALUE_OPTIONS.has(value)) {
            const optionValue = values[index + 1];
            if (!optionValue || optionValue.startsWith("--")) {
                result.error = "HeadlessPreview.OptionValueRequired";
                return result;
            }
            index++;
            if (value === "--params") {
                result.paramsPath = optionValue;
            } else if (value === "--output") {
                result.outputDirectory = optionValue;
            } else if (value === "--run-id") {
                result.runId = optionValue;
            } else if (value === "--secret-env-map") {
                result.secretEnvironmentMapPath = optionValue;
            } else {
                result.approvalManifestPath = optionValue;
            }
        } else if (value === "--deterministic-preview") {
            result.deterministicPreview = true;
        } else if (value === "--approve-preview") {
            result.approvePreview = true;
        }
    }
    if (command === "capabilities") {
        if (positionals.length > 0) {
            result.error = "HeadlessPreview.ArgumentUnexpected";
        }
        return result;
    }
    if (positionals.length > 1) {
        result.error = "HeadlessPreview.ArgumentUnexpected";
        return result;
    }
    if (result.approvalManifestPath && result.approvePreview) {
        result.error = "HeadlessPreview.OptionConflict";
        return result;
    }
    result.artifactPath = positionals[0];
    return result;
}
