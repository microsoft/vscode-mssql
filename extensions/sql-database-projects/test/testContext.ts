/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from "vscode";
import * as path from "path";
import * as sinon from "sinon";
import * as mssql from "vscode-mssql";
import * as fs from "fs";

export interface TestContext {
    context: vscode.ExtensionContext;
    dacFxService: sinon.SinonStubbedInstance<mssql.IDacFxService>;
    outputChannel: vscode.OutputChannel;
}

/**
 * Re-stubs getSqlProjectsService and getDacFxService on the utils module.
 * Call after every sinon.restore() inside a test to keep the service stubs alive.
 * @param utilsModule the imported `* as utils` namespace from `'../src/common/utils'`
 * @param dacFxService the DacFx service stub from the TestContext
 */
export function restubServices(
    utilsModule: any,
    dacFxService: sinon.SinonStubbedInstance<mssql.IDacFxService>,
): void {
    sinon.stub(utilsModule, "getSqlProjectsService").resolves(createSqlProjectsServiceStub());
    sinon.stub(utilsModule, "getDacFxService").resolves(dacFxService);
}

export const mockDacFxResult = {
    operationId: "",
    success: true,
    errorMessage: "",
    report: "",
};

export const mockSavePublishResult = {
    success: true,
    errorMessage: "",
};

/* Get the deployment options sample model */
export function getDeploymentOptions(): mssql.DeploymentOptions {
    const sampleDesc = "Sample Description text";
    const sampleName = "Sample Display Name";
    const defaultOptions: mssql.DeploymentOptions = {
        excludeObjectTypes: { value: [], description: sampleDesc, displayName: sampleName },
        booleanOptionsDictionary: {
            SampleProperty1: { value: false, description: sampleDesc, displayName: sampleName },
            SampleProperty2: { value: false, description: sampleDesc, displayName: sampleName },
        },
        objectTypesDictionary: {
            SampleProperty1: sampleName,
            SampleProperty2: sampleName,
        },
    };
    return defaultOptions;
}

export const mockDacFxOptionsResult: any = {
    success: true,
    errorMessage: "",
    deploymentOptions: getDeploymentOptions(),
};

/**
 * Creates a stub of IDacFxService using sinon.
 * Accepts an optional sandbox; falls back to bare sinon if none provided.
 */
export function createDacFxServiceStub(
    sandbox?: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<mssql.IDacFxService> {
    const s = sandbox ?? sinon;
    return {
        exportBacpac: s.stub().resolves(mockDacFxResult),
        importBacpac: s.stub().resolves(mockDacFxResult),
        extractDacpac: s.stub().resolves(mockDacFxResult),
        createProjectFromDatabase: s.stub().resolves(mockDacFxResult),
        deployDacpac: s.stub().resolves(mockDacFxResult),
        generateDeployScript: s.stub().resolves(mockDacFxResult),
        generateDeployPlan: s.stub().resolves(mockDacFxResult),
        getOptionsFromProfile: s.stub().resolves(mockDacFxOptionsResult),
        validateStreamingJob: s.stub().resolves(mockDacFxResult),
        savePublishProfile: s.stub().resolves(mockSavePublishResult),
        getDeploymentOptions: s.stub().resolves(mockDacFxOptionsResult),
    } as unknown as sinon.SinonStubbedInstance<mssql.IDacFxService>;
}

const mockResultStatus = { success: true, errorMessage: "" };

// ─── XML helpers for .sqlproj parsing ────────────────────────────────────────

/** Minimal helper – extracts the first match of <tag>value</tag> from XML text. */
function xmlTag(xml: string, tag: string): string {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
    const m = xml.match(re);
    return m ? m[1].trim() : "";
}

/** Returns all Include="…" values for a given element name. */
function xmlIncludes(xml: string, elementName: string): string[] {
    const re = new RegExp(`<${elementName}\\s+Include="([^"]+)"`, "gi");
    const results: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) {
        results.push(m[1]);
    }
    return results;
}

interface ParsedSqlProj {
    dsp: string;
    projectGuid: string;
    configuration: string;
    outputPath: string;
    defaultCollation: string;
    projectStyle: mssql.ProjectType;
    buildScripts: string[];
    folders: string[];
    preDeployScripts: string[];
    postDeployScripts: string[];
    noneItems: string[];
    sqlCmdVariables: { varName: string; defaultValue: string; value: string }[];
    systemDbReferences: {
        systemDb: mssql.SystemDatabase;
        databaseVariableLiteralName: string;
        suppressMissingDependencies: boolean;
    }[];
    dacpacReferences: mssql.DacpacReference[];
    sqlProjectReferences: mssql.SqlProjectReference[];
}

function parseSqlProj(filePath: string): ParsedSqlProj {
    const xml = fs.readFileSync(filePath, "utf-8");

    // Detect SDK style
    const isSdk =
        xml.includes("Microsoft.Build.Sql") || /<Sdk\b/i.test(xml) || /<Import.*Sdk\s*=/i.test(xml);
    const projectStyle = isSdk ? mssql.ProjectType.SdkStyle : mssql.ProjectType.LegacyStyle;

    // DSP
    const dsp =
        xmlTag(xml, "DSP") || "Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider";

    // ProjectGuid  — strip braces
    const rawGuid = xmlTag(xml, "ProjectGuid");
    const projectGuid = rawGuid.replace(/[{}]/g, "");

    // Configuration
    const configuration = xmlTag(xml, "Configuration") || "Debug";

    // OutputPath – take the first unconditional one, or the Debug one
    let outputPath = "";
    const outputPathMatch = xml.match(/<OutputPath>([^<]+)<\/OutputPath>/i);
    if (outputPathMatch) {
        outputPath = outputPathMatch[1].trim();
    }
    // For legacy projects, the conditional Debug|AnyCPU output path
    const debugOutputMatch = xml.match(/Debug\|AnyCPU[\s\S]*?<OutputPath>([^<]+)<\/OutputPath>/i);
    if (debugOutputMatch) {
        outputPath = debugOutputMatch[1].trim();
    }

    // Default collation
    const modelCollation = xmlTag(xml, "ModelCollation");
    const defaultCollation = modelCollation || "";

    // Build scripts (legacy <Build Include="…" />)
    const buildScripts = xmlIncludes(xml, "Build");

    // Folders
    const folders = xmlIncludes(xml, "Folder");

    // Pre/post deploy scripts
    const preDeployScripts = xmlIncludes(xml, "PreDeploy");
    const postDeployScripts = xmlIncludes(xml, "PostDeploy");

    // None items
    const noneItems = xmlIncludes(xml, "None");

    // Infer parent folders from all item paths (build scripts, pre/post deploy, none items)
    const allItemPaths = [...buildScripts, ...preDeployScripts, ...postDeployScripts, ...noneItems];
    for (const itemPath of allItemPaths) {
        // Skip glob patterns and items without path separators
        if (itemPath.includes("*") || itemPath.includes("?") || itemPath.includes("[")) {
            continue;
        }
        const normalized = itemPath.replace(/\//g, "\\");
        const parts = normalized.split("\\");
        if (parts.length > 1) {
            let folder = "";
            for (let i = 0; i < parts.length - 1; i++) {
                folder = folder ? folder + "\\" + parts[i] : parts[i];
                if (!folders.includes(folder)) {
                    folders.push(folder);
                }
            }
        }
    }

    // SqlCmd variables
    const sqlCmdVariables: ParsedSqlProj["sqlCmdVariables"] = [];
    const sqlCmdRe = /<SqlCmdVariable\s+Include="([^"]+)">([\s\S]*?)<\/SqlCmdVariable>/gi;
    let sqlCmdMatch: RegExpExecArray | null;
    while ((sqlCmdMatch = sqlCmdRe.exec(xml)) !== null) {
        const varName = sqlCmdMatch[1];
        const body = sqlCmdMatch[2];
        const defaultValue = xmlTag(body, "DefaultValue");
        const value = xmlTag(body, "Value");
        sqlCmdVariables.push({ varName, defaultValue, value });
    }

    // System database references (ArtifactReference to master/msdb)
    const systemDbReferences: ParsedSqlProj["systemDbReferences"] = [];
    const dacpacReferences: mssql.DacpacReference[] = [];
    const sqlProjectReferences: mssql.SqlProjectReference[] = [];

    const artifactRe =
        /<ArtifactReference[^>]*Include="([^"]+)"[^>]*>([\s\S]*?)<\/ArtifactReference>/gi;
    let artMatch: RegExpExecArray | null;
    while ((artMatch = artifactRe.exec(xml)) !== null) {
        const includePath = artMatch[1];
        const body = artMatch[2];
        const dbVarLiteral = xmlTag(body, "DatabaseVariableLiteralValue");
        const suppress = xmlTag(body, "SuppressMissingDependenciesErrors").toLowerCase() === "true";

        if (includePath.includes("master.dacpac")) {
            // Deduplicate — only add once per system db
            if (!systemDbReferences.some((r) => r.systemDb === mssql.SystemDatabase.Master)) {
                systemDbReferences.push({
                    systemDb: mssql.SystemDatabase.Master,
                    databaseVariableLiteralName: dbVarLiteral,
                    suppressMissingDependencies: suppress,
                });
            }
        } else if (includePath.includes("msdb.dacpac")) {
            if (!systemDbReferences.some((r) => r.systemDb === mssql.SystemDatabase.MSDB)) {
                systemDbReferences.push({
                    systemDb: mssql.SystemDatabase.MSDB,
                    databaseVariableLiteralName: dbVarLiteral,
                    suppressMissingDependencies: suppress,
                });
            }
        }
    }

    // Project references
    const projRefRe =
        /<ProjectReference\s+Include="([^"]+)"[^>]*(?:>([\s\S]*?)<\/ProjectReference>|\/>)/gi;
    let projRefMatch: RegExpExecArray | null;
    while ((projRefMatch = projRefRe.exec(xml)) !== null) {
        const projPath = projRefMatch[1];
        const body = projRefMatch[2] || "";
        sqlProjectReferences.push({
            projectPath: projPath,
            projectGuid: xmlTag(body, "Project") || undefined,
            suppressMissingDependencies:
                xmlTag(body, "SuppressMissingDependenciesErrors").toLowerCase() === "true",
        } as any);
    }

    return {
        dsp,
        projectGuid,
        configuration,
        outputPath,
        defaultCollation,
        projectStyle,
        buildScripts,
        folders,
        preDeployScripts,
        postDeployScripts,
        noneItems,
        sqlCmdVariables,
        systemDbReferences,
        dacpacReferences,
        sqlProjectReferences,
    };
}

// ─── New SDK project template ────────────────────────────────────────────────

function generateSdkSqlProj(dsp: string, sdkVersion: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build">
  <Sdk Name="Microsoft.Build.Sql" Version="${sdkVersion}" />
  <PropertyGroup>
    <Name>NewProject</Name>
    <DSP>${dsp}</DSP>
    <ModelCollation>1033, CI</ModelCollation>
  </PropertyGroup>
</Project>`;
}

function generateLegacySqlProj(dsp: string): string {
    return `<?xml version="1.0" encoding="utf-8"?>
<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003" ToolsVersion="4.0">
  <PropertyGroup>
    <Configuration Condition=" '$(Configuration)' == '' ">Debug</Configuration>
    <Platform Condition=" '$(Platform)' == '' ">AnyCPU</Platform>
    <Name>NewProject</Name>
    <ProjectGuid>{00000000-0000-0000-0000-000000000000}</ProjectGuid>
    <DSP>${dsp}</DSP>
    <OutputType>Database</OutputType>
    <ModelCollation>1033, CI</ModelCollation>
  </PropertyGroup>
  <PropertyGroup Condition=" '$(Configuration)|$(Platform)' == 'Debug|AnyCPU' ">
    <OutputPath>bin\\Debug\\</OutputPath>
  </PropertyGroup>
  <ItemGroup>
    <Folder Include="Properties" />
  </ItemGroup>
</Project>`;
}

// ─── Stateful ISqlProjectsService stub ───────────────────────────────────────

/**
 * Module-level project state that persists across stub re-creations
 * (e.g. after sinon.restore() + restubServices()).
 */
const sharedProjectState = new Map<string, ParsedSqlProj>();

/** Clear all cached project state. Call in setup() to start each test with a clean slate. */
export function clearProjectState(): void {
    sharedProjectState.clear();
}

/**
 * Creates a stateful stub of ISqlProjectsService using sinon.
 * Reads the actual .sqlproj XML on openProject/createProject and
 * maintains state for add/delete/exclude/move operations so that
 * the get* methods return correct data.
 *
 * State is stored in a module-level Map so that it survives
 * sinon.restore() + restubServices() calls within a single test.
 */
export function createSqlProjectsServiceStub(
    sandbox?: sinon.SinonSandbox,
): sinon.SinonStubbedInstance<mssql.ISqlProjectsService> {
    const s = sandbox ?? sinon;

    // ── Per-project state ─────────────────────────────────────────────
    const projects = sharedProjectState;

    function ensureParsed(projectUri: string): ParsedSqlProj {
        if (!projects.has(projectUri)) {
            if (fs.existsSync(projectUri)) {
                projects.set(projectUri, parseSqlProj(projectUri));
            } else {
                // Fallback empty project
                projects.set(projectUri, {
                    dsp: "Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider",
                    projectGuid: "",
                    configuration: "Debug",
                    outputPath: "bin\\Debug",
                    defaultCollation: "",
                    projectStyle: mssql.ProjectType.SdkStyle,
                    buildScripts: [],
                    folders: [],
                    preDeployScripts: [],
                    postDeployScripts: [],
                    noneItems: [],
                    sqlCmdVariables: [],
                    systemDbReferences: [],
                    dacpacReferences: [],
                    sqlProjectReferences: [],
                });
            }
        }
        return projects.get(projectUri)!;
    }

    // ── Stub construction ─────────────────────────────────────────────
    const stub: any = {};

    // Project lifecycle
    stub.openProject = s.stub().callsFake(async (projectUri: string) => {
        // Only parse from disk the first time; subsequent opens preserve in-memory mutations
        if (!projects.has(projectUri) && fs.existsSync(projectUri)) {
            projects.set(projectUri, parseSqlProj(projectUri));
        }
        return mockResultStatus;
    });

    stub.closeProject = s.stub().callsFake(async (projectUri: string) => {
        projects.delete(projectUri);
        return mockResultStatus;
    });

    stub.createProject = s
        .stub()
        .callsFake(
            async (
                projectUri: string,
                sqlProjectType: mssql.ProjectType,
                dsp?: string,
                sdkVersion?: string,
            ) => {
                const dir = path.dirname(projectUri);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                const content =
                    sqlProjectType === mssql.ProjectType.SdkStyle
                        ? generateSdkSqlProj(
                              dsp || "Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider",
                              sdkVersion || "2.0.0",
                          )
                        : generateLegacySqlProj(
                              dsp || "Microsoft.Data.Tools.Schema.Sql.Sql160DatabaseSchemaProvider",
                          );
                fs.writeFileSync(projectUri, content, "utf-8");
                projects.set(projectUri, parseSqlProj(projectUri));
                return mockResultStatus;
            },
        );

    // Project properties
    stub.getProjectProperties = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return {
            success: true,
            errorMessage: "",
            projectGuid: p.projectGuid,
            configuration: p.configuration,
            platform: "AnyCPU",
            outputPath: p.outputPath || "bin\\Debug",
            defaultCollation: p.defaultCollation,
            databaseSource: "",
            projectStyle: p.projectStyle,
            databaseSchemaProvider: p.dsp,
        };
    });

    stub.getCrossPlatformCompatibility = s
        .stub()
        .resolves({ success: true, errorMessage: "", isCrossPlatformCompatible: true });
    stub.updateProjectForCrossPlatform = s.stub().resolves(mockResultStatus);
    stub.setDatabaseSource = s.stub().resolves(mockResultStatus);
    stub.setDatabaseSchemaProvider = s.stub().callsFake(async (projectUri: string, dsp: string) => {
        const p = ensureParsed(projectUri);
        p.dsp = dsp;
        // Also update the file on disk
        if (fs.existsSync(projectUri)) {
            let xml = fs.readFileSync(projectUri, "utf-8");
            xml = xml.replace(/<DSP>[^<]*<\/DSP>/, `<DSP>${dsp}</DSP>`);
            fs.writeFileSync(projectUri, xml, "utf-8");
        }
        return mockResultStatus;
    });

    // ── Folders ────────────────────────────────────────────────────────
    stub.addFolder = s.stub().callsFake(async (projectUri: string, folderPath: string) => {
        const p = ensureParsed(projectUri);
        if (!p.folders.includes(folderPath)) {
            p.folders.push(folderPath);
        }
        // Create the folder on disk
        const fullPath = path.join(path.dirname(projectUri), folderPath);
        if (!fs.existsSync(fullPath)) {
            fs.mkdirSync(fullPath, { recursive: true });
        }
        return mockResultStatus;
    });

    stub.deleteFolder = s.stub().callsFake(async (projectUri: string, folderPath: string) => {
        const p = ensureParsed(projectUri);
        p.folders = p.folders.filter((f) => !f.startsWith(folderPath));
        p.buildScripts = p.buildScripts.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        p.preDeployScripts = p.preDeployScripts.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        p.postDeployScripts = p.postDeployScripts.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        p.noneItems = p.noneItems.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        return mockResultStatus;
    });

    stub.excludeFolder = s.stub().callsFake(async (projectUri: string, folderPath: string) => {
        const p = ensureParsed(projectUri);
        p.folders = p.folders.filter(
            (f) =>
                f !== folderPath &&
                !f.startsWith(folderPath + "\\") &&
                !f.startsWith(folderPath + "/"),
        );
        p.buildScripts = p.buildScripts.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        p.preDeployScripts = p.preDeployScripts.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        p.postDeployScripts = p.postDeployScripts.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        p.noneItems = p.noneItems.filter(
            (s) => !s.startsWith(folderPath + "\\") && !s.startsWith(folderPath + "/"),
        );
        return mockResultStatus;
    });

    stub.moveFolder = s
        .stub()
        .callsFake(async (projectUri: string, sourcePath: string, destinationPath: string) => {
            const p = ensureParsed(projectUri);
            p.folders = p.folders.map((f) => {
                if (f === sourcePath) {
                    return destinationPath;
                }
                if (f.startsWith(sourcePath + "\\") || f.startsWith(sourcePath + "/")) {
                    return destinationPath + f.substring(sourcePath.length);
                }
                return f;
            });
            return mockResultStatus;
        });

    stub.getFolders = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return { success: true, errorMessage: "", folders: [...p.folders] };
    });

    // ── SQL Object Scripts ─────────────────────────────────────────────
    stub.addSqlObjectScript = s.stub().callsFake(async (projectUri: string, scriptPath: string) => {
        const p = ensureParsed(projectUri);
        if (!p.buildScripts.includes(scriptPath)) {
            p.buildScripts.push(scriptPath);
        }
        // Infer folder from script path
        const parts = scriptPath.replace(/\\/g, "/").split("/");
        if (parts.length > 1) {
            let folder = "";
            for (let i = 0; i < parts.length - 1; i++) {
                folder = folder ? folder + "\\" + parts[i] : parts[i];
                if (!p.folders.includes(folder)) {
                    p.folders.push(folder);
                }
            }
        }
        return mockResultStatus;
    });

    stub.deleteSqlObjectScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            p.buildScripts = p.buildScripts.filter((s) => s !== scriptPath);
            return mockResultStatus;
        });

    stub.excludeSqlObjectScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            p.buildScripts = p.buildScripts.filter((s) => s !== scriptPath);
            return mockResultStatus;
        });

    stub.moveSqlObjectScript = s
        .stub()
        .callsFake(async (projectUri: string, destinationPath: string, sourcePath: string) => {
            const p = ensureParsed(projectUri);
            const idx = p.buildScripts.indexOf(sourcePath);
            if (idx >= 0) {
                p.buildScripts[idx] = destinationPath;
            }
            return mockResultStatus;
        });

    stub.getSqlObjectScripts = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return { success: true, errorMessage: "", scripts: [...p.buildScripts] };
    });

    // ── Pre-deployment scripts ──────────────────────────────────────────
    stub.addPreDeploymentScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            if (!p.preDeployScripts.includes(scriptPath)) {
                p.preDeployScripts.push(scriptPath);
            }
            return mockResultStatus;
        });

    stub.deletePreDeploymentScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            p.preDeployScripts = p.preDeployScripts.filter((s) => s !== scriptPath);
            return mockResultStatus;
        });

    stub.excludePreDeploymentScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            p.preDeployScripts = p.preDeployScripts.filter((s) => s !== scriptPath);
            return mockResultStatus;
        });

    stub.movePreDeploymentScript = s.stub().resolves(mockResultStatus);

    stub.getPreDeploymentScripts = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return { success: true, errorMessage: "", scripts: [...p.preDeployScripts] };
    });

    // ── Post-deployment scripts ─────────────────────────────────────────
    stub.addPostDeploymentScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            if (!p.postDeployScripts.includes(scriptPath)) {
                p.postDeployScripts.push(scriptPath);
            }
            return mockResultStatus;
        });

    stub.deletePostDeploymentScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            p.postDeployScripts = p.postDeployScripts.filter((s) => s !== scriptPath);
            return mockResultStatus;
        });

    stub.excludePostDeploymentScript = s
        .stub()
        .callsFake(async (projectUri: string, scriptPath: string) => {
            const p = ensureParsed(projectUri);
            p.postDeployScripts = p.postDeployScripts.filter((s) => s !== scriptPath);
            return mockResultStatus;
        });

    stub.movePostDeploymentScript = s.stub().resolves(mockResultStatus);

    stub.getPostDeploymentScripts = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return { success: true, errorMessage: "", scripts: [...p.postDeployScripts] };
    });

    // ── None items ──────────────────────────────────────────────────────
    stub.addNoneItem = s.stub().callsFake(async (projectUri: string, itemPath: string) => {
        const p = ensureParsed(projectUri);
        if (!p.noneItems.includes(itemPath)) {
            p.noneItems.push(itemPath);
        }
        return mockResultStatus;
    });

    stub.deleteNoneItem = s.stub().callsFake(async (projectUri: string, itemPath: string) => {
        const p = ensureParsed(projectUri);
        p.noneItems = p.noneItems.filter((s) => s !== itemPath);
        return mockResultStatus;
    });

    stub.excludeNoneItem = s.stub().callsFake(async (projectUri: string, itemPath: string) => {
        const p = ensureParsed(projectUri);
        p.noneItems = p.noneItems.filter((s) => s !== itemPath);
        return mockResultStatus;
    });

    stub.moveNoneItem = s.stub().resolves(mockResultStatus);

    stub.getNoneItems = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return { success: true, errorMessage: "", scripts: [...p.noneItems] };
    });

    // ── Database references ─────────────────────────────────────────────
    stub.addDacpacReference = s
        .stub()
        .callsFake(
            async (
                projectUri: string,
                dacpacPath: string,
                suppressMissingDependencies: boolean,
                databaseVariable?: string,
                serverVariable?: string,
                databaseLiteral?: string,
            ) => {
                const p = ensureParsed(projectUri);
                p.dacpacReferences.push({
                    dacpacPath,
                    suppressMissingDependencies,
                    databaseVariableLiteralName: databaseLiteral,
                    databaseVariable: databaseVariable
                        ? { varName: databaseVariable, value: "" }
                        : undefined,
                    serverVariable: serverVariable
                        ? { varName: serverVariable, value: "" }
                        : undefined,
                } as any);
                return mockResultStatus;
            },
        );

    stub.addSqlProjectReference = s
        .stub()
        .callsFake(
            async (
                projectUri: string,
                projectPath: string,
                projectGuid: string,
                suppressMissingDependencies: boolean,
                databaseVariable?: string,
                serverVariable?: string,
                databaseLiteral?: string,
            ) => {
                const p = ensureParsed(projectUri);
                p.sqlProjectReferences.push({
                    projectPath,
                    projectGuid,
                    suppressMissingDependencies,
                    databaseVariableLiteralName: databaseLiteral,
                    databaseVariable: databaseVariable
                        ? { varName: databaseVariable, value: "" }
                        : undefined,
                    serverVariable: serverVariable
                        ? { varName: serverVariable, value: "" }
                        : undefined,
                } as any);
                return mockResultStatus;
            },
        );

    stub.addSystemDatabaseReference = s
        .stub()
        .callsFake(
            async (
                projectUri: string,
                systemDb: mssql.SystemDatabase,
                suppressMissingDependencies: boolean,
                databaseLiteral?: string,
            ) => {
                const p = ensureParsed(projectUri);
                p.systemDbReferences.push({
                    systemDb,
                    databaseVariableLiteralName: databaseLiteral || "",
                    suppressMissingDependencies,
                });
                return mockResultStatus;
            },
        );

    stub.addNugetPackageReference = s.stub().resolves(mockResultStatus);

    stub.deleteDatabaseReference = s.stub().callsFake(async (projectUri: string, name: string) => {
        const p = ensureParsed(projectUri);
        p.systemDbReferences = p.systemDbReferences.filter((r) => {
            const dbName = r.systemDb === mssql.SystemDatabase.Master ? "master" : "msdb";
            return dbName !== name && r.databaseVariableLiteralName !== name;
        });
        p.dacpacReferences = p.dacpacReferences.filter((r) => r.dacpacPath !== name);
        p.sqlProjectReferences = p.sqlProjectReferences.filter((r) => r.projectPath !== name);
        return mockResultStatus;
    });

    stub.getDatabaseReferences = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return {
            success: true,
            errorMessage: "",
            systemDatabaseReferences: [...p.systemDbReferences],
            dacpacReferences: [...p.dacpacReferences],
            sqlProjectReferences: [...p.sqlProjectReferences],
            nugetPackageReferences: [],
        };
    });

    // ── SQLCMD variables ────────────────────────────────────────────────
    stub.addSqlCmdVariable = s
        .stub()
        .callsFake(async (projectUri: string, name: string, defaultValue: string) => {
            const p = ensureParsed(projectUri);
            const existing = p.sqlCmdVariables.find((v) => v.varName === name);
            if (existing) {
                existing.defaultValue = defaultValue;
            } else {
                p.sqlCmdVariables.push({ varName: name, defaultValue, value: "" });
            }
            return mockResultStatus;
        });

    stub.deleteSqlCmdVariable = s.stub().callsFake(async (projectUri: string, name: string) => {
        const p = ensureParsed(projectUri);
        p.sqlCmdVariables = p.sqlCmdVariables.filter((v) => v.varName !== name);
        return mockResultStatus;
    });

    stub.updateSqlCmdVariable = s
        .stub()
        .callsFake(async (projectUri: string, name: string, defaultValue: string) => {
            const p = ensureParsed(projectUri);
            const existing = p.sqlCmdVariables.find((v) => v.varName === name);
            if (existing) {
                existing.defaultValue = defaultValue;
            }
            return mockResultStatus;
        });

    stub.getSqlCmdVariables = s.stub().callsFake(async (projectUri: string) => {
        const p = ensureParsed(projectUri);
        return {
            success: true,
            errorMessage: "",
            sqlCmdVariables: p.sqlCmdVariables.map((v) => ({
                varName: v.varName,
                defaultValue: v.defaultValue,
                value: v.value,
            })),
        };
    });

    return stub as unknown as sinon.SinonStubbedInstance<mssql.ISqlProjectsService>;
}

export function createContext(): TestContext {
    let extensionPath = path.join(__dirname, "..", "..");

    return {
        context: {
            subscriptions: [],
            workspaceState: {
                get: () => {
                    return undefined;
                },
                update: () => {
                    return Promise.resolve();
                },
                keys: () => [],
            },
            globalState: {
                setKeysForSync: (): void => {},
                get: (): any | undefined => {
                    return Promise.resolve();
                },
                update: (): Thenable<void> => {
                    return Promise.resolve();
                },
                keys: () => [],
            },
            extensionPath: extensionPath,
            asAbsolutePath: () => {
                return "";
            },
            storagePath: "",
            globalStoragePath: "",
            logPath: "",
            extensionUri: vscode.Uri.parse(""),
            environmentVariableCollection: undefined as any,
            extensionMode: undefined as any,
            globalStorageUri: vscode.Uri.parse("test://"),
            logUri: vscode.Uri.parse("test://"),
            storageUri: vscode.Uri.parse("test://"),
            secrets: undefined as any,
            extension: undefined as any,
            languageModelAccessInformation: undefined as any,
        },
        dacFxService: createDacFxServiceStub(),
        outputChannel: {
            name: "",
            append: () => {},
            appendLine: () => {},
            clear: () => {},
            show: () => {},
            hide: () => {},
            dispose: () => {},
            replace: () => {},
        },
    };
}

export const mockConnectionProfile: any = {
    connectionName: "My Connection",
    serverName: "My Server",
    databaseName: "My Database",
    userName: "My User",
    password: "My Pwd",
    authenticationType: "SqlLogin",
    savePassword: false,
    groupFullName: "My groupName",
    groupId: "My GroupId",
    providerName: "My Server",
    saveProfile: true,
    id: "My Id",
    options: {
        server: "My Server",
        database: "My Database",
        user: "My User",
        password: "My Pwd",
        authenticationType: "SqlLogin",
        connectionName: "My Connection Name",
    },
};

export const mockURIList: vscode.Uri[] = [
    vscode.Uri.file("/test/folder/abc.sqlproj"),
    vscode.Uri.file("/test/folder/folder1/abc1.sqlproj"),
    vscode.Uri.file("/test/folder/folder2/abc2.sqlproj"),
];

export const mockConnectionInfo = {
    id: undefined,
    userName: "My User",
    password: "My Pwd",
    serverName: "My Server",
    databaseName: "My Database",
    connectionName: "My Connection",
    providerName: undefined,
    groupId: "My GroupId",
    groupFullName: "My groupName",
    authenticationType: "SqlLogin",
    savePassword: false,
    saveProfile: true,
    options: {
        server: "My Server",
        database: "My Database",
        user: "My User",
        password: "My Pwd",
        authenticationType: "SqlLogin",
        connectionName: "My Connection Name",
    },
};
