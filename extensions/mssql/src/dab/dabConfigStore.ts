/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * File-backed store for the Data API builder designer.
 *
 * Every unique server/database pair gets its own directory under the extension's
 * global storage, holding the designer configuration and the DAB containers that
 * have been deployed from it:
 *
 *   <globalStorage>/dab/<key>/config.json
 *   <globalStorage>/dab/<key>/deployments.json
 *
 * The key is a sha256 of the normalized server and the exact database name, so
 * neither spelling ever appears in a path, and the saved config follows the
 * database regardless of which login was used to reach it.
 *
 * Only the designer model is written to disk. Connection strings are never
 * persisted; the real DAB config file is generated into a temp directory at
 * deployment time and deleted once it has been copied into the container.
 *
 * Writes go to a sibling temp file that is renamed over the target, so a reader
 * only ever sees a complete previous or complete new file. Reads never throw:
 * a missing, unreadable, or malformed file is reported as "nothing saved".
 */

import { createHash } from "crypto";
import * as fsPromises from "fs/promises";
import * as path from "path";
import { Dab } from "../sharedInterfaces/dab";
import { getErrorMessage, uuid } from "../utils/utils";

/** Directory under global storage that holds every DAB designer key. */
const DAB_STORE_DIR_NAME = "dab";
const CONFIG_FILE_NAME = "config.json";
const DEPLOYMENTS_FILE_NAME = "deployments.json";

/**
 * Length-prefixing the server before the database name keeps the hash input
 * unambiguous: no server/database pair can be re-split to produce another.
 */
function buildKeyHashInput(server: string, database: string): string {
    const normalizedServer = server.trim().toLowerCase();
    return `${normalizedServer.length}:${normalizedServer}:${database}`;
}

/**
 * Bumped only when a change makes previously written files unreadable. Files
 * carrying a different version are ignored, which resets the designer to
 * defaults rather than surfacing a broken config.
 */
export const DAB_STORE_FORMAT_VERSION = 1;

interface DabConfigFileContents {
    version: number;
    /** Exact spellings, kept in the file body rather than in the path. */
    server: string;
    database: string;
    updatedUtc: string;
    config: Dab.DabConfig;
}

interface DabDeploymentsFileContents {
    version: number;
    deployments: Dab.DabDeploymentRecord[];
}

/** Identifies the database a saved configuration belongs to. */
export interface DabStoreKey {
    server: string;
    database: string;
}

/**
 * Computes the directory name for a server/database pair. Server names are
 * folded to lower case because SQL Server hostnames are case insensitive;
 * database names are hashed byte-exact because they may not be.
 */
export function computeDabStoreKey(key: DabStoreKey): string {
    const digest = createHash("sha256")
        .update(buildKeyHashInput(key.server, key.database), "utf8")
        .digest("base64url");
    return `dab_${digest.slice(0, 22)}`;
}

/** Minimal filesystem surface, injectable so tests never touch a real disk. */
export interface DabStoreFs {
    readFile(filePath: string): Promise<string>;
    writeFile(filePath: string, contents: string): Promise<void>;
    rename(fromPath: string, toPath: string): Promise<void>;
    unlink(filePath: string): Promise<void>;
    mkdirp(dirPath: string): Promise<void>;
}

export const nodeDabStoreFs: DabStoreFs = {
    readFile: (filePath) => fsPromises.readFile(filePath, "utf8"),
    writeFile: (filePath, contents) =>
        // Owner read/write only: the designer config describes a user's database shape.
        fsPromises.writeFile(filePath, contents, { encoding: "utf8", mode: 0o600 }),
    rename: (fromPath, toPath) => fsPromises.rename(fromPath, toPath),
    unlink: (filePath) => fsPromises.unlink(filePath),
    mkdirp: async (dirPath) => {
        await fsPromises.mkdir(dirPath, { recursive: true });
    },
};

export class DabConfigStore {
    constructor(
        private readonly rootPath: string,
        private readonly fs: DabStoreFs = nodeDabStoreFs,
    ) {}

    /**
     * Reads the saved designer configuration, or undefined when nothing usable
     * is stored for this database.
     */
    public async getConfig(key: DabStoreKey): Promise<Dab.DabConfig | undefined> {
        const contents = await this.readJson<DabConfigFileContents>(this.configPath(key));
        if (contents?.version !== DAB_STORE_FORMAT_VERSION) {
            return undefined;
        }

        return contents.config;
    }

    /** Writes the designer configuration, replacing whatever was there before. */
    public async saveConfig(key: DabStoreKey, config: Dab.DabConfig): Promise<void> {
        const contents: DabConfigFileContents = {
            version: DAB_STORE_FORMAT_VERSION,
            server: key.server,
            database: key.database,
            updatedUtc: new Date().toISOString(),
            config,
        };

        await this.writeJson(this.configPath(key), contents);
    }

    /**
     * Discards the saved configuration so the next load rebuilds defaults from
     * the live schema. Deployment history is deliberately left alone.
     */
    public async deleteConfig(key: DabStoreKey): Promise<void> {
        try {
            await this.fs.unlink(this.configPath(key));
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
    }

    /** Returns the deployments tracked for this database, oldest first. */
    public async getDeployments(key: DabStoreKey): Promise<Dab.DabDeploymentRecord[]> {
        const contents = await this.readJson<DabDeploymentsFileContents>(this.deploymentsPath(key));
        if (
            contents?.version !== DAB_STORE_FORMAT_VERSION ||
            !Array.isArray(contents.deployments)
        ) {
            return [];
        }

        return contents.deployments;
    }

    /**
     * Records a newly deployed container or engine. A record with the same name
     * is replaced rather than duplicated, which is what happens when a user
     * removes a container outside VS Code and deploys the same name again.
     */
    public async addDeployment(
        key: DabStoreKey,
        deployment: Omit<Dab.DabDeploymentRecord, "id" | "createdUtc" | "deployedUtc">,
    ): Promise<Dab.DabDeploymentRecord> {
        const now = new Date().toISOString();
        const record: Dab.DabDeploymentRecord = {
            ...deployment,
            id: uuid(),
            createdUtc: now,
            deployedUtc: now,
        };

        const deployments = (await this.getDeployments(key)).filter(
            (existing) => existing.name !== record.name,
        );
        await this.writeDeployments(key, [...deployments, record]);
        return record;
    }

    /**
     * Applies a partial update to a tracked deployment. Returns the updated
     * record, or undefined when the deployment is no longer tracked.
     */
    public async updateDeployment(
        key: DabStoreKey,
        deploymentId: string,
        update: Partial<Omit<Dab.DabDeploymentRecord, "id">>,
    ): Promise<Dab.DabDeploymentRecord | undefined> {
        const deployments = await this.getDeployments(key);
        const index = deployments.findIndex((deployment) => deployment.id === deploymentId);
        if (index === -1) {
            return undefined;
        }

        const updated: Dab.DabDeploymentRecord = { ...deployments[index], ...update };
        deployments[index] = updated;
        await this.writeDeployments(key, deployments);
        return updated;
    }

    /** Stops tracking a deployment. Removing the container itself is the caller's job. */
    public async removeDeployment(key: DabStoreKey, deploymentId: string): Promise<void> {
        const deployments = await this.getDeployments(key);
        const remaining = deployments.filter((deployment) => deployment.id !== deploymentId);
        if (remaining.length === deployments.length) {
            return;
        }

        await this.writeDeployments(key, remaining);
    }

    /**
     * Directory holding a CLI deployment's generated config. The engine reads
     * this file for as long as it runs, so it lives alongside the deployment
     * record rather than in a temp directory.
     */
    public getCliDeploymentDirectory(key: DabStoreKey, name: string): string {
        return path.join(this.keyDirectory(key), "cli", sanitizePathSegment(name));
    }

    /** Removes a CLI deployment's directory, config file and all. */
    public async deleteCliDeployment(key: DabStoreKey, name: string): Promise<void> {
        await fsPromises.rm(this.getCliDeploymentDirectory(key, name), {
            recursive: true,
            force: true,
        });
    }

    private async writeDeployments(
        key: DabStoreKey,
        deployments: Dab.DabDeploymentRecord[],
    ): Promise<void> {
        const contents: DabDeploymentsFileContents = {
            version: DAB_STORE_FORMAT_VERSION,
            deployments,
        };

        await this.writeJson(this.deploymentsPath(key), contents);
    }

    private configPath(key: DabStoreKey): string {
        return path.join(this.keyDirectory(key), CONFIG_FILE_NAME);
    }

    private deploymentsPath(key: DabStoreKey): string {
        return path.join(this.keyDirectory(key), DEPLOYMENTS_FILE_NAME);
    }

    private keyDirectory(key: DabStoreKey): string {
        return path.join(this.rootPath, DAB_STORE_DIR_NAME, computeDabStoreKey(key));
    }

    private async readJson<T>(filePath: string): Promise<T | undefined> {
        try {
            return JSON.parse(await this.fs.readFile(filePath)) as T;
        } catch {
            // A missing file and a torn or hand-edited one are the same thing to
            // a caller: there is nothing usable to restore.
            return undefined;
        }
    }

    /**
     * Writes through a sibling temp file so a concurrent reader sees either the
     * complete previous file or the complete new one, never a partial write.
     */
    private async writeJson(filePath: string, contents: unknown): Promise<void> {
        await this.fs.mkdirp(path.dirname(filePath));

        const tempPath = `${filePath}.${process.pid}.${Date.now().toString(36)}.tmp`;
        try {
            await this.fs.writeFile(tempPath, JSON.stringify(contents, undefined, 2));
            await this.fs.rename(tempPath, filePath);
        } catch (error) {
            await this.fs.unlink(tempPath).catch(() => {});
            throw new Error(
                `Failed to write ${path.basename(filePath)}: ${getErrorMessage(error)}`,
            );
        }
    }
}

/**
 * Keeps a deployment name usable as a single directory name. Names are already
 * validated against the container-name pattern before reaching here; this makes
 * a stored record that predates or bypasses that validation harmless.
 */
function sanitizePathSegment(value: string): string {
    return value.replace(/[^A-Za-z0-9_.-]/g, "_") || "deployment";
}

function isMissingFileError(error: unknown): boolean {
    return (error as { code?: string })?.code === "ENOENT";
}
