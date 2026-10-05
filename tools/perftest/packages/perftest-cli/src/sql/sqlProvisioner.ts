/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * SQL provisioning (design §13.4): put SQL Server into a known, deterministic
 * state before measurement and hand the harness a connection profile.
 *
 * Providers:
 *  - dockerCompose: digest-pinned SQL Server container via docker compose,
 *    seeded through sqlcmd inside the container.
 *  - external: an already-reachable SQL Server (connection string from an env
 *    var named by config.sql.connectionStringEnv), seeded via host sqlcmd.
 *
 * Redaction rule (§29): passwords/connection strings never reach logs,
 * markers, or results. Only server host + database names are logged.
 */

import { execFile, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import type { PerfConfig } from "@mssqlperf/contracts";
import type { ConnectionProfileSpec } from "@mssqlperf/contracts";
import type { HarnessLogger } from "../telemetry/logger";

export interface ProvisionedSql {
    /** Profile handed to the driver for non-interactive product connections. */
    profile: ConnectionProfileSpec;
    /** How the state was prepared, for environment/validation records. */
    validation: { name: string; status: "passed" | "failed" | "warning"; message: string };
    provider: string;
}

export class SqlProvisionError extends Error {}

export interface VerifyQuery {
    sql: string;
    expect: string;
}

export async function provisionSql(
    config: PerfConfig,
    logger: HarnessLogger,
    options: { seedFiles: string[]; verifyQuery?: VerifyQuery; verifyQueries?: VerifyQuery[] },
): Promise<ProvisionedSql> {
    const span = logger.span("sql.provision", { provider: config.sql.provider });
    try {
        let result: ProvisionedSql;
        switch (config.sql.provider) {
            case "external":
                result = await provisionExternal(config, logger, options);
                break;
            case "dockerCompose":
                result = await provisionDockerCompose(config, logger, options);
                break;
            default:
                throw new SqlProvisionError(
                    `SQL provider '${config.sql.provider}' is not implemented yet`,
                );
        }
        span.end({ server: result.profile.server, database: result.profile.database });
        return result;
    } catch (error) {
        span.fail(error);
        throw error;
    }
}

// ---------------------------------------------------------------------------
// external provider
// ---------------------------------------------------------------------------

interface ParsedConnectionString {
    server: string;
    database?: string;
    user?: string;
    password?: string;
    encrypt?: string;
    trustServerCertificate?: boolean;
    integrated: boolean;
}

/** Parse an ADO.NET-style connection string. Values are never logged. */
export function parseSqlConnectionString(connectionString: string): ParsedConnectionString {
    const parts = new Map<string, string>();
    for (const [key, value] of parseConnectionStringPairs(connectionString)) {
        parts.set(key.toLowerCase(), value);
    }
    const get = (...keys: string[]): string | undefined => {
        for (const key of keys) {
            const value = parts.get(key);
            if (value !== undefined) return value;
        }
        return undefined;
    };
    const server = get("server", "data source", "address", "addr");
    if (!server) {
        throw new SqlProvisionError("Connection string has no Server/Data Source");
    }
    const integratedRaw = get("integrated security", "trusted_connection");
    const integrated =
        integratedRaw !== undefined &&
        ["true", "sspi", "yes"].includes(integratedRaw.toLowerCase());
    const trustRaw = get("trustservercertificate", "trust server certificate");
    const parsed: ParsedConnectionString = { server, integrated };
    const database = get("database", "initial catalog");
    if (database !== undefined) parsed.database = database;
    const user = get("user id", "uid", "user");
    if (user !== undefined) parsed.user = user;
    const password = get("password", "pwd");
    if (password !== undefined) parsed.password = password;
    const encrypt = get("encrypt");
    if (encrypt !== undefined) parsed.encrypt = encrypt;
    if (trustRaw !== undefined) {
        parsed.trustServerCertificate = ["true", "yes"].includes(trustRaw.toLowerCase());
    }
    return parsed;
}

/** Parse quoted ADO.NET and brace-delimited ODBC-style values without exposing them. */
function parseConnectionStringPairs(connectionString: string): Array<[string, string]> {
    const pairs: Array<[string, string]> = [];
    let offset = 0;
    while (offset < connectionString.length) {
        while (offset < connectionString.length && /[;\s]/u.test(connectionString[offset]!)) {
            offset++;
        }
        if (offset >= connectionString.length) break;

        const equals = connectionString.indexOf("=", offset);
        if (equals < 0) {
            throw new SqlProvisionError("Connection string contains a key without '='");
        }
        const key = connectionString.slice(offset, equals).trim();
        if (!key) {
            throw new SqlProvisionError("Connection string contains an empty key");
        }
        offset = equals + 1;
        while (offset < connectionString.length && /\s/u.test(connectionString[offset]!)) {
            offset++;
        }

        let value = "";
        const opener = connectionString[offset];
        if (opener === "'" || opener === '"') {
            const quote = opener;
            offset++;
            let closed = false;
            while (offset < connectionString.length) {
                const char = connectionString[offset++]!;
                if (char === quote) {
                    if (connectionString[offset] === quote) {
                        value += quote;
                        offset++;
                    } else {
                        closed = true;
                        break;
                    }
                } else {
                    value += char;
                }
            }
            if (!closed) {
                throw new SqlProvisionError(
                    `Connection string value for '${key}' has no closing quote`,
                );
            }
        } else if (opener === "{") {
            offset++;
            let closed = false;
            while (offset < connectionString.length) {
                const char = connectionString[offset++]!;
                if (char === "}") {
                    if (connectionString[offset] === "}") {
                        value += "}";
                        offset++;
                    } else {
                        closed = true;
                        break;
                    }
                } else {
                    value += char;
                }
            }
            if (!closed) {
                throw new SqlProvisionError(
                    `Connection string value for '${key}' has no closing brace`,
                );
            }
        } else {
            const semicolon = connectionString.indexOf(";", offset);
            const end = semicolon < 0 ? connectionString.length : semicolon;
            value = connectionString.slice(offset, end).trim();
            offset = end;
        }

        while (offset < connectionString.length && /\s/u.test(connectionString[offset]!)) {
            offset++;
        }
        if (offset < connectionString.length && connectionString[offset] !== ";") {
            throw new SqlProvisionError(
                `Connection string value for '${key}' must be followed by ';'`,
            );
        }
        if (connectionString[offset] === ";") offset++;
        pairs.push([key, value]);
    }
    return pairs;
}

export function createExternalConnectionProfile(
    connectionString: string,
    seeded: boolean,
): ConnectionProfileSpec {
    const parsed = parseSqlConnectionString(connectionString);
    return {
        server: parsed.server,
        database: seeded ? "PerfHarness" : (parsed.database ?? "master"),
        authenticationType: parsed.integrated ? "Integrated" : "SqlLogin",
        ...(parsed.user !== undefined ? { user: parsed.user } : {}),
        ...(parsed.password !== undefined ? { password: parsed.password } : {}),
        ...(parsed.encrypt !== undefined ? { encrypt: parsed.encrypt } : {}),
        ...(parsed.trustServerCertificate !== undefined
            ? { trustServerCertificate: parsed.trustServerCertificate }
            : {}),
    };
}

async function provisionExternal(
    config: PerfConfig,
    logger: HarnessLogger,
    options: { seedFiles: string[]; verifyQuery?: VerifyQuery; verifyQueries?: VerifyQuery[] },
): Promise<ProvisionedSql> {
    const envName = (config.sql["connectionStringEnv"] as string) ?? "STS2_SQLSERVER_CONNSTRING";
    const connectionString = process.env[envName];
    if (!connectionString) {
        throw new SqlProvisionError(
            `External SQL provider needs env var ${envName} with a connection string`,
        );
    }
    const parsed = parseSqlConnectionString(connectionString);
    logger.info("sql.external", undefined, {
        envVar: envName,
        server: parsed.server,
        integrated: parsed.integrated,
    });

    const { args: sqlcmdBase, env: sqlcmdEnv } = buildHostSqlcmd(parsed);
    for (const seedFile of options.seedFiles) {
        runSqlcmd([...sqlcmdBase, "-i", resolve(seedFile)], sqlcmdEnv, logger, `seed:${seedFile}`);
    }

    let validation = verify(sqlcmdBase, sqlcmdEnv, options.verifyQuery, logger);
    for (const extraVerify of options.verifyQueries ?? []) {
        validation = verify(sqlcmdBase, sqlcmdEnv, extraVerify, logger);
    }

    const profile = createExternalConnectionProfile(connectionString, options.seedFiles.length > 0);
    return { profile, validation, provider: "external" };
}

/**
 * Host sqlcmd invocation. Works with both classic ODBC sqlcmd and go-sqlcmd:
 * no -C/-N flags (encryption is negotiated), and the password travels in the
 * SQLCMDPASSWORD env var so it never appears in a process command line.
 */
function buildHostSqlcmd(parsed: ParsedConnectionString): {
    args: string[];
    env: Record<string, string>;
} {
    const args = ["-S", parsed.server, "-b"];
    const env: Record<string, string> = {};
    if (parsed.integrated) {
        args.push("-E");
    } else {
        if (!parsed.user || parsed.password === undefined) {
            throw new SqlProvisionError(
                "Connection string has neither integrated auth nor user/password",
            );
        }
        args.push("-U", parsed.user);
        env["SQLCMDPASSWORD"] = parsed.password;
    }
    return { args, env };
}

// ---------------------------------------------------------------------------
// dockerCompose provider
// ---------------------------------------------------------------------------

async function provisionDockerCompose(
    config: PerfConfig,
    logger: HarnessLogger,
    options: { seedFiles: string[]; verifyQuery?: VerifyQuery; verifyQueries?: VerifyQuery[] },
): Promise<ProvisionedSql> {
    const composeFile = config.sql.composeFile;
    if (!composeFile) {
        throw new SqlProvisionError("dockerCompose provider requires sql.composeFile");
    }
    const service = config.sql.service ?? "sqlserver";
    const saPassword = requireDockerSaPassword();

    const composeArgs = ["compose", "-f", resolve(composeFile)];
    logger.info("sql.compose.up", undefined, { composeFile, service });
    await execDocker(
        [...composeArgs, "up", "-d", "--wait", service],
        { PERF_SQL_SA_PASSWORD: saPassword },
        logger,
        600_000,
    );

    // Seed via sqlcmd inside the container (seed dir is volume-mounted at /perf-seed).
    const execBase = [
        ...composeArgs,
        "exec",
        "-e",
        "SQLCMDPASSWORD",
        "-T",
        service,
        "/opt/mssql-tools18/bin/sqlcmd",
        "-S",
        "localhost",
        "-U",
        "sa",
        "-C",
        "-b",
    ];
    for (const seedFile of options.seedFiles) {
        const name = seedFile.split(/[\\/]/).pop();
        logger.info("sql.seed", undefined, { file: name });
        await execDocker(
            [...execBase, "-i", `/perf-seed/${name}`],
            { PERF_SQL_SA_PASSWORD: saPassword, SQLCMDPASSWORD: saPassword },
            logger,
            300_000,
        );
    }

    let validation: ProvisionedSql["validation"] = {
        name: "sqlSeedVerified",
        status: "warning",
        message: "no verify query configured",
    };
    const verifyQueries = [options.verifyQuery, ...(options.verifyQueries ?? [])].filter(
        (query): query is VerifyQuery => query !== undefined,
    );
    for (const verifyQuery of verifyQueries) {
        const output = await execDocker(
            [...execBase, "-h", "-1", "-Q", verifyQuery.sql],
            { PERF_SQL_SA_PASSWORD: saPassword, SQLCMDPASSWORD: saPassword },
            logger,
            120_000,
        );
        const ok = output.includes(verifyQuery.expect);
        validation = {
            name: "sqlSeedVerified",
            status: ok ? "passed" : "failed",
            message: ok
                ? `verify query returned ${verifyQuery.expect}`
                : `verify query did not return ${verifyQuery.expect}`,
        };
        if (!ok) {
            throw new SqlProvisionError(validation.message);
        }
    }

    const hostPort = (config.sql["hostPort"] as number | string) ?? 14333;
    return {
        profile: {
            server: `127.0.0.1,${hostPort}`,
            database: "PerfHarness",
            authenticationType: "SqlLogin",
            user: "sa",
            password: saPassword,
            trustServerCertificate: true,
        },
        validation,
        provider: "dockerCompose",
    };
}

export async function teardownDockerCompose(
    config: PerfConfig,
    logger: HarnessLogger,
): Promise<void> {
    if (config.sql.provider !== "dockerCompose" || !config.sql.composeFile) {
        return;
    }
    // Keep the container across runs unless explicitly configured to recycle:
    // container reuse with per-run seeding is the warm-cache default.
    if (config.sql["recycleContainer"] === true) {
        await execDocker(
            ["compose", "-f", resolve(config.sql.composeFile), "down"],
            {},
            logger,
            120_000,
        );
    }
}

// ---------------------------------------------------------------------------

function runSqlcmd(
    args: string[],
    env: Record<string, string>,
    logger: HarnessLogger,
    label: string,
): string {
    try {
        logger.debug("sql.sqlcmd", label);
        return execFileSync("sqlcmd", args, {
            encoding: "utf8",
            timeout: 300_000,
            windowsHide: true,
            env: { ...process.env, ...env },
        });
    } catch (error) {
        const err = error as { stdout?: string; stderr?: string; message?: string };
        throw new SqlProvisionError(
            `sqlcmd failed (${label}): ${redact(String(err.stderr || err.stdout || err.message || error))}`,
        );
    }
}

function verify(
    sqlcmdBase: string[],
    env: Record<string, string>,
    verifyQuery: { sql: string; expect: string } | undefined,
    logger: HarnessLogger,
): ProvisionedSql["validation"] {
    if (!verifyQuery) {
        return {
            name: "sqlSeedVerified",
            status: "warning",
            message: "no verify query configured",
        };
    }
    const output = runSqlcmd(
        [...sqlcmdBase, "-h", "-1", "-Q", verifyQuery.sql],
        env,
        logger,
        "verify",
    );
    const ok = output.includes(verifyQuery.expect);
    if (!ok) {
        throw new SqlProvisionError(
            `Seed verification failed: expected '${verifyQuery.expect}' in query output`,
        );
    }
    logger.info("sql.verified", undefined, { expect: verifyQuery.expect });
    return {
        name: "sqlSeedVerified",
        status: "passed",
        message: `verify query returned ${verifyQuery.expect}`,
    };
}

function execDocker(
    args: string[],
    env: Record<string, string>,
    logger: HarnessLogger,
    timeoutMs: number,
): Promise<string> {
    // Redact the value FOLLOWING -P as well as the flag itself.
    const redacted = args.map((a, i) => (a === "-P" || args[i - 1] === "-P" ? "<redacted>" : a));
    logger.debug("sql.docker", redacted.join(" ").slice(0, 200));
    return new Promise((resolvePromise, reject) => {
        execFile(
            "docker",
            args,
            {
                env: { ...process.env, ...env },
                timeout: timeoutMs,
                windowsHide: true,
                shell: false,
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(
                        new SqlProvisionError(
                            `docker ${args[0]} ${args[1] ?? ""} failed: ${redact(stderr || stdout || String(error))}`,
                        ),
                    );
                } else {
                    resolvePromise(stdout);
                }
            },
        );
    });
}

function requireDockerSaPassword(): string {
    const password = process.env["PERF_SQL_SA_PASSWORD"];
    if (!password) {
        throw new SqlProvisionError(
            "dockerCompose provider requires PERF_SQL_SA_PASSWORD; set a strong disposable local-container password",
        );
    }
    return password;
}

/** Strip likely secrets from error text before it can reach logs. */
function redact(text: string): string {
    return text.replace(/(-P\s+\S+|password\s*=\s*[^;\s]+|pwd\s*=\s*[^;\s]+)/gi, "<redacted>");
}

// ---------------------------------------------------------------------------
// Ad-hoc SQL execution seam (collectors: XEvents session control + reads).
// ---------------------------------------------------------------------------

export type SqlExecutor = (sql: string, label: string) => Promise<string>;

/**
 * Build a SQL executor for the configured provider, or undefined when SQL is
 * not configured. Single-batch SQL only (no GO); passed as one argv element
 * (execFile, no shell) so no quoting pitfalls; secrets never on argv (host
 * path uses SQLCMDPASSWORD; container path stays inside the container).
 */
export function createSqlExecutor(
    config: PerfConfig,
    logger: HarnessLogger,
): SqlExecutor | undefined {
    if (config.sql.provider === "external") {
        const envName =
            (config.sql["connectionStringEnv"] as string) ?? "STS2_SQLSERVER_CONNSTRING";
        const connectionString = process.env[envName];
        if (!connectionString) {
            return undefined;
        }
        const parsed = parseSqlConnectionString(connectionString);
        const { args, env } = buildHostSqlcmd(parsed);
        return async (sql, label) =>
            new Promise<string>((resolvePromise, reject) => {
                execFile(
                    "sqlcmd",
                    // -y 0 (unlimited variable-width) is incompatible with -h -1 in ODBC
                    // sqlcmd; header lines are harmless to the JSON reader. -I turns on
                    // QUOTED_IDENTIFIER, required by the XML methods in XEvents reads.
                    [...args, "-I", "-y", "0", "-Q", sql],
                    {
                        env: { ...process.env, ...env },
                        timeout: 120_000,
                        windowsHide: true,
                        maxBuffer: 64 * 1024 * 1024,
                    },
                    (error, stdout, stderr) => {
                        if (error) {
                            reject(
                                new SqlProvisionError(
                                    `sqlcmd failed (${label}): ${redact(stderr || stdout || String(error))}`,
                                ),
                            );
                        } else {
                            logger.trace("sql.exec", label);
                            resolvePromise(stdout);
                        }
                    },
                );
            });
    }
    if (config.sql.provider === "dockerCompose" && config.sql.composeFile) {
        const composeFile = resolve(config.sql.composeFile);
        const service = config.sql.service ?? "sqlserver";
        const saPassword = requireDockerSaPassword();
        return async (sql, label) => {
            logger.trace("sql.exec", label);
            return execDocker(
                [
                    "compose",
                    "-f",
                    composeFile,
                    "exec",
                    "-e",
                    "SQLCMDPASSWORD",
                    "-T",
                    service,
                    "/opt/mssql-tools18/bin/sqlcmd",
                    "-S",
                    "localhost",
                    "-U",
                    "sa",
                    "-C",
                    "-b",
                    "-I",
                    "-y",
                    "0",
                    "-Q",
                    sql,
                ],
                { PERF_SQL_SA_PASSWORD: saPassword, SQLCMDPASSWORD: saPassword },
                logger,
                120_000,
            );
        };
    }
    return undefined;
}
