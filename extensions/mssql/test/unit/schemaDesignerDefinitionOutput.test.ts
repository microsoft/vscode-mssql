/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import {
    getSchemaDesignerDefinitionOutput,
    SchemaDesignerDefinitionKind,
} from "../../src/sharedInterfaces/schemaDesignerDefinitionOutput";

suite("SchemaDesignerDefinitionOutput tests", () => {
    const schema: SchemaDesigner.Schema = {
        tables: [
            createTable({
                id: "categories",
                name: "Categories",
                columns: [
                    createColumn({
                        id: "category-id",
                        name: "CategoryId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                    }),
                    createColumn({
                        id: "category-name",
                        name: "Name",
                        dataType: "nvarchar",
                        maxLength: "100",
                    }),
                ],
            }),
            createTable({
                id: "products",
                name: "Products",
                columns: [
                    createColumn({
                        id: "product-id",
                        name: "ProductId",
                        dataType: "int",
                        isPrimaryKey: true,
                        isIdentity: true,
                    }),
                    createColumn({
                        id: "product-name",
                        name: "Name",
                        dataType: "nvarchar",
                        maxLength: "100",
                    }),
                    createColumn({
                        id: "product-category-id",
                        name: "CategoryId",
                        dataType: "int",
                        isNullable: true,
                    }),
                ],
                foreignKeys: [
                    createForeignKey({
                        id: "fk-products-categories",
                        name: "FK_Products_Categories",
                        columnsIds: ["product-category-id"],
                        referencedTableId: "categories",
                        referencedColumnsIds: ["category-id"],
                    }),
                ],
            }),
        ],
    };

    test("renders prisma output with mapped tables, columns, schemas, and relations", () => {
        const output = getSchemaDesignerDefinitionOutput(
            schema,
            SchemaDesignerDefinitionKind.Prisma,
        );

        expect(output.language).to.equal("prisma");
        expect(output.text).to.include('schemas  = ["dbo"]');
        expect(output.text).to.include("model Categories");
        expect(output.text).to.include("model Products");
        expect(output.text).to.include(
            'categoryId Int @id @default(autoincrement()) @map("CategoryId")',
        );
        expect(output.text).to.include('name String @db.NVarChar(100) @map("Name")');
        expect(output.text).to.include(
            '@relation("FK_Products_Categories", fields: [categoryId], references: [categoryId])',
        );
        expect(output.text).to.include('@@map("Products")');
        expect(output.text).to.include('@@schema("dbo")');
        expect(output.text).to.not.include('@@map("dbo.Products")');
    });

    test("disambiguates multiple foreign keys between the same two tables", () => {
        const schemaWithMultipleForeignKeys: SchemaDesigner.Schema = {
            tables: [
                createTable({
                    id: "users",
                    name: "Users",
                    columns: [
                        createColumn({
                            id: "user-id",
                            name: "UserId",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                    ],
                }),
                createTable({
                    id: "orders",
                    name: "Orders",
                    columns: [
                        createColumn({
                            id: "order-id",
                            name: "OrderId",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                        createColumn({
                            id: "created-by-user-id",
                            name: "CreatedByUserId",
                            dataType: "int",
                        }),
                        createColumn({
                            id: "updated-by-user-id",
                            name: "UpdatedByUserId",
                            dataType: "int",
                        }),
                    ],
                    foreignKeys: [
                        createForeignKey({
                            id: "fk-orders-created-by",
                            name: "FK_Orders_CreatedBy",
                            columnsIds: ["created-by-user-id"],
                            referencedTableId: "users",
                            referencedColumnsIds: ["user-id"],
                        }),
                        createForeignKey({
                            id: "fk-orders-updated-by",
                            name: "FK_Orders_UpdatedBy",
                            columnsIds: ["updated-by-user-id"],
                            referencedTableId: "users",
                            referencedColumnsIds: ["user-id"],
                        }),
                    ],
                }),
            ],
        };

        const output = getSchemaDesignerDefinitionOutput(
            schemaWithMultipleForeignKeys,
            SchemaDesignerDefinitionKind.Prisma,
        );

        expect(output.text).to.include("createdByUser Users @relation");
        expect(output.text).to.include("updatedByUser Users @relation");
        expect(output.text).to.include(
            'ordersCreatedByUser Orders[] @relation("FK_Orders_CreatedBy")',
        );
        expect(output.text).to.include(
            'ordersUpdatedByUser Orders[] @relation("FK_Orders_UpdatedBy")',
        );
    });

    test("renders TypeORM composite foreign key join columns", () => {
        const output = getSchemaDesignerDefinitionOutput(
            getCompositeForeignKeySchema(),
            SchemaDesignerDefinitionKind.TypeOrm,
        );

        expect(output.text).to.include(
            '@JoinColumn([{ name: "ProductId", referencedColumnName: "productId" }, { name: "TenantId", referencedColumnName: "tenantId" }])',
        );
        expect(output.text).to.include(
            '@PrimaryColumn({ name: "ProductId", type: "int", nullable: false })',
        );
        expect(output.text).to.include(
            '@PrimaryColumn({ name: "TenantId", type: "int", nullable: false })',
        );
    });

    test("renders SQLAlchemy date annotations and composite foreign key constraints", () => {
        const output = getSchemaDesignerDefinitionOutput(
            getCompositeForeignKeySchema(),
            SchemaDesignerDefinitionKind.SqlAlchemy,
        );

        expect(output.language).to.equal("python");
        expect(output.text).to.include("from datetime import datetime");
        expect(output.text).to.include("created_at: Mapped[datetime]");
        expect(output.text).to.include(
            'ForeignKeyConstraint(["ProductId", "TenantId"], ["dbo.Products.ProductId", "dbo.Products.TenantId"])',
        );
    });

    test("renders Sequelize output with typed helper signatures", () => {
        const output = getSchemaDesignerDefinitionOutput(
            schema,
            SchemaDesignerDefinitionKind.Sequelize,
        );

        expect(output.text).to.include(
            'import { DataTypes, type Model, type ModelStatic, type Sequelize } from "sequelize";',
        );
        expect(output.text).to.include("export function initModels(sequelize: Sequelize) {");
        expect(output.text).to.include("const models: Record<string, ModelStatic<Model>> = {};");
        expect(output.text).to.include(
            "export function associateModels(models: Record<string, ModelStatic<Model>>) {",
        );
    });

    test("renders TypeORM output without unused relation imports", () => {
        const simpleSchema: SchemaDesigner.Schema = {
            tables: [
                createTable({
                    id: "customers",
                    name: "Customers",
                    columns: [
                        createColumn({
                            id: "customer-id",
                            name: "CustomerId",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                        createColumn({
                            id: "customer-name",
                            name: "Name",
                            dataType: "nvarchar",
                            maxLength: "100",
                        }),
                    ],
                }),
            ],
        };

        const output = getSchemaDesignerDefinitionOutput(
            simpleSchema,
            SchemaDesignerDefinitionKind.TypeOrm,
        );

        expect(output.text).to.include('import { Column, Entity, PrimaryColumn } from "typeorm";');
        expect(output.text).to.not.include("JoinColumn");
        expect(output.text).to.not.include("ManyToOne");
        expect(output.text).to.not.include("OneToMany");
        expect(output.text).to.not.include("PrimaryGeneratedColumn");
    });

    test("renders SQLAlchemy output without unused imports", () => {
        const simpleSchema: SchemaDesigner.Schema = {
            tables: [
                createTable({
                    id: "customers",
                    name: "Customers",
                    columns: [
                        createColumn({
                            id: "customer-id",
                            name: "CustomerId",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                        createColumn({
                            id: "customer-name",
                            name: "Name",
                            dataType: "nvarchar",
                            maxLength: "100",
                        }),
                    ],
                }),
            ],
        };

        const output = getSchemaDesignerDefinitionOutput(
            simpleSchema,
            SchemaDesignerDefinitionKind.SqlAlchemy,
        );

        expect(output.text).to.include("from sqlalchemy import Integer, Unicode");
        expect(output.text).to.not.include("from datetime import");
        expect(output.text).to.not.include("from decimal import Decimal");
        expect(output.text).to.not.include("ForeignKeyConstraint");
        expect(output.text).to.not.include("ForeignKey(");
    });

    test("renders SQLAlchemy nullable column annotations", () => {
        const output = getSchemaDesignerDefinitionOutput(
            schema,
            SchemaDesignerDefinitionKind.SqlAlchemy,
        );

        expect(output.text).to.include("category_id: Mapped[int | None]");
    });

    test("renders Drizzle output as table declarations with mapped names", () => {
        const output = getSchemaDesignerDefinitionOutput(
            schema,
            SchemaDesignerDefinitionKind.Drizzle,
        );

        expect(output.language).to.equal("typescript");
        expect(output.text).to.include('export const dboSchema = mssqlSchema("dbo");');
        expect(output.text).to.include('export const products = dboSchema.table("Products", {');
        expect(output.text).to.include(
            'productId: int("ProductId").notNull().primaryKey().identity()',
        );
        expect(output.text).to.include('name: nvarchar("Name", { length: 100 }).notNull()');
        expect(output.text).to.not.include("Add table() wrappers");
    });

    test("renders EF Core output with entities, column mappings, and relationships", () => {
        const output = getSchemaDesignerDefinitionOutput(
            schema,
            SchemaDesignerDefinitionKind.EfCore,
        );

        expect(output.language).to.equal("csharp");
        expect(output.text).to.include("public partial class Products");
        expect(output.text).to.include("public partial class Categories");
        expect(output.text).to.include("public partial class AppDbContext");
        expect(output.text).to.include("DbSet<Products>");
        expect(output.text).to.include('entity.ToTable("Products", "dbo")');
        expect(output.text).to.include(
            'entity.Property(e => e.ProductId).HasColumnName("ProductId")',
        );
        expect(output.text).to.include("entity.HasOne(d => d.Category)");
        expect(output.text).to.include(".WithMany(p => p.Products)");
        expect(output.text).to.include(".HasForeignKey(d => d.CategoryId)");
    });

    test("renders EF Core output without unnecessary usings and initializes required references", () => {
        const requiredRelationSchema: SchemaDesigner.Schema = {
            tables: [
                createTable({
                    id: "categories",
                    name: "Categories",
                    columns: [
                        createColumn({
                            id: "category-id",
                            name: "CategoryId",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                    ],
                }),
                createTable({
                    id: "products",
                    name: "Products",
                    columns: [
                        createColumn({
                            id: "product-id",
                            name: "ProductId",
                            dataType: "int",
                            isPrimaryKey: true,
                        }),
                        createColumn({
                            id: "product-category-id",
                            name: "CategoryId",
                            dataType: "int",
                            isNullable: false,
                        }),
                    ],
                    foreignKeys: [
                        createForeignKey({
                            id: "fk-products-categories",
                            name: "FK_Products_Categories",
                            columnsIds: ["product-category-id"],
                            referencedTableId: "categories",
                            referencedColumnsIds: ["category-id"],
                        }),
                    ],
                }),
            ],
        };

        const output = getSchemaDesignerDefinitionOutput(
            requiredRelationSchema,
            SchemaDesignerDefinitionKind.EfCore,
        );

        expect(output.text).to.not.include("using System;\n");
        expect(output.text).to.include("using System.Collections.Generic;");
        expect(output.text).to.include("public virtual Categories Category { get; set; } = null!;");
    });

    test("falls back when a column has a null data type at runtime", () => {
        const schemaWithNullType: SchemaDesigner.Schema = {
            tables: [
                createTable({
                    id: "runtime-null-type",
                    name: "RuntimeNullType",
                    columns: [
                        createColumn({
                            id: "runtime-null-type-id",
                            name: "Id",
                            dataType: null as unknown as string,
                            isPrimaryKey: true,
                        }),
                    ],
                }),
            ],
        };

        const output = getSchemaDesignerDefinitionOutput(
            schemaWithNullType,
            SchemaDesignerDefinitionKind.Prisma,
        );

        expect(output.language).to.equal("prisma");
        expect(output.text).to.include("model RuntimeNullType");
        expect(output.text).to.include('id String @id @db.NVarChar(MAX) @map("Id")');
    });

    test("does not emit warning comments for unsupported schema details", () => {
        const schemaWithWarnings: SchemaDesigner.Schema = {
            tables: [
                createTable({
                    id: "computed-table",
                    name: "ComputedTable",
                    columns: [
                        createColumn({
                            id: "id",
                            name: "Id",
                            dataType: "int",
                            isPrimaryKey: true,
                            defaultValue: "NEXT VALUE FOR dbo.IdSequence",
                        }),
                        createColumn({
                            id: "full-name",
                            name: "FullName",
                            dataType: "nvarchar",
                            maxLength: "200",
                            isComputed: true,
                            computedFormula: "[FirstName] + [LastName]",
                        }),
                    ],
                }),
            ],
        };

        const output = getSchemaDesignerDefinitionOutput(
            schemaWithWarnings,
            SchemaDesignerDefinitionKind.Prisma,
        );

        expect(output.text).to.not.include("Manual review required:");
        expect(output.text).to.not.include("computed column expression was not translated");
        expect(output.text).to.not.include("SQL Server default expression");
        expect(output.text).to.include("model ComputedTable");
    });
});

function createColumn(overrides: Partial<SchemaDesigner.Column>): SchemaDesigner.Column {
    return {
        id: "column-id",
        name: "ColumnName",
        dataType: "int",
        maxLength: "",
        precision: 0,
        scale: 0,
        isPrimaryKey: false,
        isIdentity: false,
        identitySeed: 0,
        identityIncrement: 0,
        isNullable: false,
        defaultValue: "",
        isComputed: false,
        computedFormula: "",
        computedPersisted: false,
        ...overrides,
    };
}

function createTable(overrides: Partial<SchemaDesigner.Table>): SchemaDesigner.Table {
    return {
        id: "table-id",
        name: "TableName",
        schema: "dbo",
        columns: [],
        foreignKeys: [],
        ...overrides,
    };
}

function createForeignKey(
    overrides: Partial<SchemaDesigner.ForeignKey>,
): SchemaDesigner.ForeignKey {
    return {
        id: "foreign-key-id",
        name: "FK_Table_ReferencedTable",
        columnsIds: [],
        referencedTableId: "referenced-table-id",
        referencedColumnsIds: [],
        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
        ...overrides,
    };
}

function getCompositeForeignKeySchema(): SchemaDesigner.Schema {
    return {
        tables: [
            createTable({
                id: "products",
                name: "Products",
                columns: [
                    createColumn({
                        id: "product-id",
                        name: "ProductId",
                        dataType: "int",
                        isPrimaryKey: true,
                    }),
                    createColumn({
                        id: "tenant-id",
                        name: "TenantId",
                        dataType: "int",
                        isPrimaryKey: true,
                    }),
                ],
            }),
            createTable({
                id: "order-lines",
                name: "OrderLines",
                columns: [
                    createColumn({
                        id: "order-line-id",
                        name: "OrderLineId",
                        dataType: "int",
                        isPrimaryKey: true,
                    }),
                    createColumn({
                        id: "product-id-ref",
                        name: "ProductId",
                        dataType: "int",
                    }),
                    createColumn({
                        id: "tenant-id-ref",
                        name: "TenantId",
                        dataType: "int",
                    }),
                    createColumn({
                        id: "created-at",
                        name: "CreatedAt",
                        dataType: "datetime2",
                    }),
                ],
                foreignKeys: [
                    createForeignKey({
                        id: "fk-order-lines-products",
                        name: "FK_OrderLines_Products",
                        columnsIds: ["product-id-ref", "tenant-id-ref"],
                        referencedTableId: "products",
                        referencedColumnsIds: ["product-id", "tenant-id"],
                    }),
                ],
            }),
        ],
    };
}
