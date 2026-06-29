/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Cloud Deploy — headless environment loader.
 *
 * Reads and validates an `environments.json` from an absolute path with no
 * dependency on `vscode.Uri` / `vscode.WorkspaceFolder`, so the CLI / CI runner
 * can consume the same file the extension's `environmentFile.ts` reads. Parsing
 * and validation reuse the existing zod `validateEnvironmentsFile` verbatim —
 * identical shape checks, identical `EnvironmentsFileParseError`, zero schema
 * duplication. Resolving a single environment by id lives here too so the CLI
 * has one place to turn "config path + env id" into a typed `Environment`.
 *
 * Unlike the extension loader, a missing file is an ERROR (the CLI was told
 * which config to use; an absent one is a usage problem), not an empty file.
 */

import { promises as fs } from "fs";

import { Environment, EnvironmentsFile } from "./types";
import { EnvironmentsFileParseError, validateEnvironmentsFile } from "./environmentSchema";

/**
 * Thrown when the requested environment id is not present in the file. Carries
 * the available ids so the CLI can print an actionable message.
 */
export class EnvironmentNotFoundError extends Error {
    public constructor(
        public readonly envId: string,
        public readonly availableIds: readonly string[],
    ) {
        const available = availableIds.length > 0 ? availableIds.join(", ") : "(none)";
        super(`No environment with id "${envId}". Available ids: ${available}.`);
        this.name = "EnvironmentNotFoundError";
    }
}

/**
 * Reads and validates `environments.json` at `absPath`. Throws
 * `EnvironmentsFileParseError` when the file is missing, is not valid JSON, or
 * fails schema validation.
 */
export async function loadEnvironmentsFromPath(absPath: string): Promise<EnvironmentsFile> {
    let raw: string;
    try {
        raw = await fs.readFile(absPath, { encoding: "utf8" });
    } catch (err) {
        if (isEnoent(err)) {
            throw new EnvironmentsFileParseError(
                absPath,
                `Environments file not found: ${absPath}`,
                err,
            );
        }
        throw err;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (err) {
        throw new EnvironmentsFileParseError(
            absPath,
            `Failed to parse ${absPath}: ${(err as Error).message}`,
            err,
        );
    }

    return validateEnvironmentsFile(parsed, absPath);
}

/** Finds the environment with `envId`, or throws `EnvironmentNotFoundError`. */
export function resolveEnvironment(file: EnvironmentsFile, envId: string): Environment {
    const env = file.environments.find((candidate) => candidate.id === envId);
    if (env === undefined) {
        throw new EnvironmentNotFoundError(
            envId,
            file.environments.map((candidate) => candidate.id),
        );
    }
    return env;
}

interface NodeFsError extends Error {
    code?: string;
}

function isEnoent(err: unknown): err is NodeFsError {
    return err instanceof Error && (err as NodeFsError).code === "ENOENT";
}
