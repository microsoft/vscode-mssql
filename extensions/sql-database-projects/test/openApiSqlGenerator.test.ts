/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import * as path from "path";
import { promises as fs } from "fs";
import * as testUtils from "./testUtils";
import { TestContext, createContext } from "./testContext";
import {
    mapOpenApiTypeToSql,
    buildCreateTableSql,
    buildEnumTableSql,
    buildListTableSql,
    buildJunctionTableSql,
    getSchemaDefinitions,
    generateSqlFilesFromSpec,
    OpenApiSpec,
} from "../src/tools/openApiSqlGenerator";

let testContext: TestContext;

suite("OpenAPI SQL Generator", function (): void {
    setup(function (): void {
        testContext = createContext();
    });

    suiteTeardown(async function (): Promise<void> {
        await testUtils.deleteGeneratedTestFolder();
    });

    // -------------------------------------------------------------------------
    suite("mapOpenApiTypeToSql", function (): void {
        test("maps string to NVARCHAR(MAX)", function (): void {
            expect(mapOpenApiTypeToSql("string")).to.equal("NVARCHAR(MAX)");
        });

        test("maps string+date-time to DATETIME2", function (): void {
            expect(mapOpenApiTypeToSql("string", "date-time")).to.equal("DATETIME2");
        });

        test("maps string+date to DATE", function (): void {
            expect(mapOpenApiTypeToSql("string", "date")).to.equal("DATE");
        });

        test("maps string+uuid to UNIQUEIDENTIFIER", function (): void {
            expect(mapOpenApiTypeToSql("string", "uuid")).to.equal("UNIQUEIDENTIFIER");
        });

        test("maps string+byte to VARBINARY(MAX)", function (): void {
            expect(mapOpenApiTypeToSql("string", "byte")).to.equal("VARBINARY(MAX)");
        });

        test("maps string+binary to VARBINARY(MAX)", function (): void {
            expect(mapOpenApiTypeToSql("string", "binary")).to.equal("VARBINARY(MAX)");
        });

        test("maps integer (no format) to INT", function (): void {
            expect(mapOpenApiTypeToSql("integer")).to.equal("INT");
        });

        test("maps integer+int32 to INT", function (): void {
            expect(mapOpenApiTypeToSql("integer", "int32")).to.equal("INT");
        });

        test("maps integer+int64 to BIGINT", function (): void {
            expect(mapOpenApiTypeToSql("integer", "int64")).to.equal("BIGINT");
        });

        test("maps number to FLOAT", function (): void {
            expect(mapOpenApiTypeToSql("number")).to.equal("FLOAT");
        });

        test("maps boolean to BIT", function (): void {
            expect(mapOpenApiTypeToSql("boolean")).to.equal("BIT");
        });

        test("maps unknown type to NVARCHAR(MAX) as fallback", function (): void {
            expect(mapOpenApiTypeToSql("exotic-type")).to.equal("NVARCHAR(MAX)");
        });
    });

    // -------------------------------------------------------------------------
    suite("buildCreateTableSql", function (): void {
        test("generates CREATE TABLE with correctly mapped column types", function (): void {
            const sql = buildCreateTableSql("Pet", "dbo", {
                id: { type: "integer", format: "int64" },
                name: { type: "string" },
                active: { type: "boolean" },
                score: { type: "number" },
                createdAt: { type: "string", format: "date-time" },
            });

            expect(sql).to.include("CREATE TABLE [dbo].[Pet]");
            expect(sql).to.include("[id] BIGINT");
            expect(sql).to.include("[name] NVARCHAR(MAX)");
            expect(sql).to.include("[active] BIT");
            expect(sql).to.include("[score] FLOAT");
            expect(sql).to.include("[createdAt] DATETIME2");
        });

        test("skips array-type properties", function (): void {
            const sql = buildCreateTableSql("Pet", "dbo", {
                tags: { type: "array", items: { type: "string" } },
                name: { type: "string" },
            });

            expect(sql).to.include("[name] NVARCHAR(MAX)");
            expect(sql).to.not.include("[tags]");
        });

        test("skips $ref properties", function (): void {
            const sql = buildCreateTableSql("Pet", "dbo", {
                category: { $ref: "#/definitions/Category" },
                name: { type: "string" },
            });

            expect(sql).to.include("[name] NVARCHAR(MAX)");
            expect(sql).to.not.include("[category]");
        });

        test("skips nested object-type properties", function (): void {
            const sql = buildCreateTableSql("Pet", "dbo", {
                metadata: { type: "object" },
                name: { type: "string" },
            });

            expect(sql).to.include("[name] NVARCHAR(MAX)");
            expect(sql).to.not.include("[metadata]");
        });

        test("returns empty string when no mappable scalar columns exist", function (): void {
            const sql = buildCreateTableSql("Wrapper", "dbo", {
                items: { type: "array" },
                nested: { $ref: "#/definitions/Other" },
            });

            expect(sql).to.equal("");
        });

        test("escapes ] in table and column names", function (): void {
            const sql = buildCreateTableSql("My]Table", "dbo", {
                "col]Name": { type: "string" },
            });

            expect(sql).to.include("[My]]Table]");
            expect(sql).to.include("[col]]Name]");
        });
    });

    // -------------------------------------------------------------------------
    suite("buildEnumTableSql", function (): void {
        test("generates a single Value column of NVARCHAR(MAX)", function (): void {
            const sql = buildEnumTableSql("PetStatus", "dbo");
            expect(sql).to.include("CREATE TABLE [dbo].[PetStatus]");
            expect(sql).to.include("[Value] NVARCHAR(MAX)");
        });
    });

    // -------------------------------------------------------------------------
    suite("buildListTableSql", function (): void {
        test("generates a Value column with the mapped scalar type", function (): void {
            const sql = buildListTableSql("PetPhotoUrls", "dbo", "string");
            expect(sql).to.include("CREATE TABLE [dbo].[PetPhotoUrls]");
            expect(sql).to.include("[Value] NVARCHAR(MAX)");
        });

        test("respects format when mapping item type", function (): void {
            const sql = buildListTableSql("MyDates", "dbo", "string", "date-time");
            expect(sql).to.include("[Value] DATETIME2");
        });
    });

    // -------------------------------------------------------------------------
    suite("buildJunctionTableSql", function (): void {
        test("generates two Id columns for parent and referenced types", function (): void {
            const sql = buildJunctionTableSql("PetToTags", "dbo", "Pet", "Tag");
            expect(sql).to.include("CREATE TABLE [dbo].[PetToTags]");
            expect(sql).to.include("[PetId] INT");
            expect(sql).to.include("[TagId] INT");
        });
    });

    // -------------------------------------------------------------------------
    suite("getSchemaDefinitions", function (): void {
        test("returns definitions from an OpenAPI v2 spec", function (): void {
            const spec: OpenApiSpec = {
                swagger: "2.0",
                definitions: {
                    Pet: { type: "object", properties: { id: { type: "integer" } } },
                },
            };

            const schemas = getSchemaDefinitions(spec);
            expect(Object.keys(schemas)).to.deep.equal(["Pet"]);
        });

        test("returns components.schemas from an OpenAPI v3 spec", function (): void {
            const spec: OpenApiSpec = {
                openapi: "3.0.0",
                components: {
                    schemas: {
                        Order: { type: "object", properties: { id: { type: "integer" } } },
                    },
                },
            };

            const schemas = getSchemaDefinitions(spec);
            expect(Object.keys(schemas)).to.deep.equal(["Order"]);
        });

        test("returns empty object when neither field is present", function (): void {
            const schemas = getSchemaDefinitions({});
            expect(schemas).to.deep.equal({});
        });
    });

    // -------------------------------------------------------------------------
    suite("generateSqlFilesFromSpec (integration)", function (): void {
        test("generates SQL table files from a JSON OpenAPI v2 spec", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const spec: OpenApiSpec = {
                swagger: "2.0",
                definitions: {
                    Pet: {
                        type: "object",
                        properties: {
                            id: { type: "integer", format: "int64" },
                            name: { type: "string" },
                            active: { type: "boolean" },
                        },
                    },
                    Order: {
                        type: "object",
                        properties: {
                            orderId: { type: "integer" },
                            total: { type: "number" },
                        },
                    },
                },
            };

            const specFile = path.join(outputFolder, "spec.json");
            await fs.writeFile(specFile, JSON.stringify(spec));

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            expect(result.filesWritten).to.equal(2, "Should write one file per object schema");

            const petSql = await fs.readFile(path.join(outputFolder, "Tables", "Pet.sql"), "utf-8");
            expect(petSql).to.include("CREATE TABLE [dbo].[Pet]");
            expect(petSql).to.include("[id] BIGINT");
            expect(petSql).to.include("[name] NVARCHAR(MAX)");
            expect(petSql).to.include("[active] BIT");

            const orderSql = await fs.readFile(
                path.join(outputFolder, "Tables", "Order.sql"),
                "utf-8",
            );
            expect(orderSql).to.include("CREATE TABLE [dbo].[Order]");
            expect(orderSql).to.include("[orderId] INT");
            expect(orderSql).to.include("[total] FLOAT");
        });

        test("generates PostDeploymentScript.sql when enum properties are present", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const spec: OpenApiSpec = {
                swagger: "2.0",
                definitions: {
                    Pet: {
                        type: "object",
                        properties: {
                            id: { type: "integer" },
                            status: {
                                type: "string",
                                enum: ["available", "pending", "sold"],
                            },
                        },
                    },
                },
            };

            const specFile = path.join(outputFolder, "spec.json");
            await fs.writeFile(specFile, JSON.stringify(spec));

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            // Pet.sql (main) + PetStatus.sql (enum lookup) + PostDeploymentScript.sql
            expect(result.filesWritten).to.equal(3);

            const petSql = await fs.readFile(path.join(outputFolder, "Tables", "Pet.sql"), "utf-8");
            expect(petSql).to.include("CREATE TABLE [dbo].[Pet]");
            expect(petSql).to.include("[id] INT");
            expect(petSql).to.include("[status] NVARCHAR(MAX)");

            const enumTableSql = await fs.readFile(
                path.join(outputFolder, "Tables", "PetStatus.sql"),
                "utf-8",
            );
            expect(enumTableSql).to.include("CREATE TABLE [dbo].[PetStatus]");
            expect(enumTableSql).to.include("[Value] NVARCHAR(MAX)");

            const postDeployContent = await fs.readFile(
                path.join(outputFolder, "PostDeploymentScript.sql"),
                "utf-8",
            );
            expect(postDeployContent).to.include("INSERT INTO [dbo].[PetStatus]");
            expect(postDeployContent).to.include("'available'");
            expect(postDeployContent).to.include("'pending'");
            expect(postDeployContent).to.include("'sold'");
        });

        test("generates list table for array-of-string properties", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const spec: OpenApiSpec = {
                swagger: "2.0",
                definitions: {
                    Pet: {
                        type: "object",
                        properties: {
                            id: { type: "integer" },
                            photoUrls: { type: "array", items: { type: "string" } },
                        },
                    },
                },
            };
            const specFile = path.join(outputFolder, "spec.json");
            await fs.writeFile(specFile, JSON.stringify(spec));

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            // Pet.sql (main) + PetPhotoUrls.sql (list table)
            expect(result.filesWritten).to.equal(2);
            const listSql = await fs.readFile(
                path.join(outputFolder, "Tables", "PetPhotoUrls.sql"),
                "utf-8",
            );
            expect(listSql).to.include("CREATE TABLE [dbo].[PetPhotoUrls]");
            expect(listSql).to.include("[Value] NVARCHAR(MAX)");
        });

        test("generates junction table for array-of-ref properties", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const spec: OpenApiSpec = {
                swagger: "2.0",
                definitions: {
                    Pet: {
                        type: "object",
                        properties: {
                            id: { type: "integer" },
                            tags: { type: "array", items: { $ref: "#/definitions/Tag" } },
                        },
                    },
                    Tag: {
                        type: "object",
                        properties: { id: { type: "integer" }, name: { type: "string" } },
                    },
                },
            };
            const specFile = path.join(outputFolder, "spec.json");
            await fs.writeFile(specFile, JSON.stringify(spec));

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            // Pet.sql + PetToTags.sql + Tag.sql
            expect(result.filesWritten).to.equal(3);
            const junctionSql = await fs.readFile(
                path.join(outputFolder, "Tables", "PetToTags.sql"),
                "utf-8",
            );
            expect(junctionSql).to.include("CREATE TABLE [dbo].[PetToTags]");
            expect(junctionSql).to.include("[PetId] INT");
            expect(junctionSql).to.include("[TagId] INT");
        });

        test("skips schemas with no mappable scalar columns", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const spec: OpenApiSpec = {
                swagger: "2.0",
                definitions: {
                    // Only has an array and a $ref — nothing to map
                    PetList: {
                        type: "object",
                        properties: {
                            items: { type: "array" },
                            ref: { $ref: "#/definitions/Pet" },
                        },
                    },
                    Pet: {
                        type: "object",
                        properties: { id: { type: "integer" } },
                    },
                },
            };

            const specFile = path.join(outputFolder, "spec.json");
            await fs.writeFile(specFile, JSON.stringify(spec));

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            expect(result.filesWritten).to.equal(1, "Only Pet should produce a file");
            const tablesFolder = path.join(outputFolder, "Tables");
            const files = await fs.readdir(tablesFolder);
            expect(files).to.not.include("PetList.sql");
        });

        test("handles spec with no schema definitions gracefully", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const spec: OpenApiSpec = { swagger: "2.0" };
            const specFile = path.join(outputFolder, "spec.json");
            await fs.writeFile(specFile, JSON.stringify(spec));

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            expect(result.filesWritten).to.equal(0);
        });

        test("parses YAML spec files in addition to JSON", async function (): Promise<void> {
            const outputFolder = await testUtils.generateTestFolderPath(this.test);
            const yamlContent = [
                "swagger: '2.0'",
                "definitions:",
                "  Category:",
                "    type: object",
                "    properties:",
                "      id:",
                "        type: integer",
                "        format: int64",
                "      name:",
                "        type: string",
            ].join("\n");

            const specFile = path.join(outputFolder, "spec.yaml");
            await fs.writeFile(specFile, yamlContent);

            const result = await generateSqlFilesFromSpec(
                specFile,
                outputFolder,
                testContext.outputChannel,
            );

            expect(result.filesWritten).to.equal(1);
            const categorySql = await fs.readFile(
                path.join(outputFolder, "Tables", "Category.sql"),
                "utf-8",
            );
            expect(categorySql).to.include("CREATE TABLE [dbo].[Category]");
            expect(categorySql).to.include("[id] BIGINT");
            expect(categorySql).to.include("[name] NVARCHAR(MAX)");
        });
    });
});
