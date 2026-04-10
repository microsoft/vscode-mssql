/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import { SchemaDesigner } from "../../src/sharedInterfaces/schemaDesigner";
import { SchemaDesignerDefinitionFormat } from "../../src/webviews/pages/SchemaDesigner/definition/schemaDesignerDefinitionFormats";
import {
    generateSchemaDesignerDefinition,
    getSchemaDesignerScriptValue,
} from "../../src/webviews/pages/SchemaDesigner/definition/schemaDesignerOrmDefinitionGenerator";

suite("SchemaDesigner ORM definition generator", () => {
    const schema: SchemaDesigner.Schema = {
        tables: [
            {
                id: "roles-table",
                name: "Roles",
                schema: "dbo",
                columns: [
                    {
                        id: "roles-id",
                        name: "Id",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                    {
                        id: "roles-name",
                        name: "Name",
                        dataType: "nvarchar",
                        maxLength: "100",
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
                    },
                ],
                foreignKeys: [],
            },
            {
                id: "users-table",
                name: "Users",
                schema: "dbo",
                columns: [
                    {
                        id: "users-id",
                        name: "Id",
                        dataType: "int",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: true,
                        isIdentity: true,
                        identitySeed: 1,
                        identityIncrement: 1,
                        isNullable: false,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                    {
                        id: "users-role-id",
                        name: "RoleId",
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
                    },
                    {
                        id: "users-display-name",
                        name: "Display Name",
                        dataType: "nvarchar",
                        maxLength: "80",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: false,
                        isIdentity: false,
                        identitySeed: 0,
                        identityIncrement: 0,
                        isNullable: true,
                        defaultValue: "",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                    {
                        id: "users-is-active",
                        name: "IsActive",
                        dataType: "bit",
                        maxLength: "",
                        precision: 0,
                        scale: 0,
                        isPrimaryKey: false,
                        isIdentity: false,
                        identitySeed: 0,
                        identityIncrement: 0,
                        isNullable: false,
                        defaultValue: "((1))",
                        isComputed: false,
                        computedFormula: "",
                        computedPersisted: false,
                    },
                ],
                foreignKeys: [
                    {
                        id: "users-role-fk",
                        name: "FK_Users_Roles",
                        columnsIds: ["users-role-id"],
                        referencedTableId: "roles-table",
                        referencedColumnsIds: ["roles-id"],
                        onDeleteAction: SchemaDesigner.OnAction.NO_ACTION,
                        onUpdateAction: SchemaDesigner.OnAction.NO_ACTION,
                    },
                ],
            },
        ],
    };

    test("should generate Prisma schema text with relations and mapped identifiers", () => {
        const result = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.Prisma,
            schema,
        );

        expect(result).to.contain("generator client");
        expect(result).to.contain("model Users {");
        expect(result).to.contain('displayName String? @map("Display Name")');
        expect(result).to.contain('@default(dbgenerated("((1))"))');
        expect(result).to.contain('usersCollection Users[] @relation("FK_Users_Roles")');
        expect(result).to.contain(
            'role Roles @relation("FK_Users_Roles", fields: [roleId], references: [id], onDelete: NoAction, onUpdate: NoAction)',
        );
    });

    test("should generate TypeORM and Sequelize scaffolds from the same schema", () => {
        const typeOrmResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.TypeOrm,
            schema,
        );
        const sequelizeResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.Sequelize,
            schema,
        );

        expect(typeOrmResult).to.contain('@Entity({ name: "Users", schema: "dbo" })');
        expect(typeOrmResult).to.contain("@ManyToOne(() => Roles");
        expect(typeOrmResult).to.contain(
            '@JoinColumn([{ name: "RoleId", referencedColumnName: "id" }])',
        );
        expect(sequelizeResult).to.contain('const Users = sequelize.define("Users"');
        expect(sequelizeResult).to.contain("Users.belongsTo(Roles");
        expect(sequelizeResult).to.contain("Roles.hasMany(Users");
    });

    test("should generate Drizzle, SQLAlchemy, and EF Core scaffolds", () => {
        const drizzleResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.DrizzleOrm,
            schema,
        );
        const sqlAlchemyResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.SqlAlchemy,
            schema,
        );
        const efCoreResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.EfCore,
            schema,
        );

        expect(drizzleResult).to.contain('const dboSchema = pgSchema("dbo")');
        expect(drizzleResult).to.contain('export const users = dboSchema.table("Users"');
        expect(drizzleResult).to.contain("usersRelations = relations(users");
        expect(sqlAlchemyResult).to.contain("class Users(Base):");
        expect(sqlAlchemyResult).to.contain('__table_args__ = {"schema": "dbo"}');
        expect(sqlAlchemyResult).to.contain(
            'usersCollection: Mapped[list["Users"]] = relationship(back_populates="role")',
        );
        expect(sqlAlchemyResult).to.contain(
            'role: Mapped["Roles"] = relationship(back_populates="usersCollection")',
        );
        expect(efCoreResult).to.contain('[Table("Users", Schema = "dbo")]');
        expect(efCoreResult).to.contain("public virtual Roles Role { get; set; } = null!;");
        expect(efCoreResult).to.contain(
            "public virtual ICollection<Users> UsersCollection { get; set; } = new List<Users>();",
        );
    });

    test("should derive non-T-SQL script content from the selected ORM format", () => {
        const result = getSchemaDesignerScriptValue(
            SchemaDesignerDefinitionFormat.Prisma,
            "CREATE TABLE [dbo].[Users] (...)",
            schema,
        );

        expect(result).to.contain("model Users {");
        expect(result).to.not.contain("CREATE TABLE");
    });

    test("should preserve the current T-SQL definition when T-SQL is selected", () => {
        const tsqlDefinition = "CREATE TABLE [dbo].[Users] ([Id] int NOT NULL);";

        const result = getSchemaDesignerScriptValue(
            SchemaDesignerDefinitionFormat.TSql,
            tsqlDefinition,
            schema,
        );

        expect(result).to.equal(tsqlDefinition);
    });

    test("should fall back to a string-compatible type when a column data type is missing", () => {
        const schemaWithMissingType: SchemaDesigner.Schema = {
            tables: schema.tables.map((table) => ({
                ...table,
                columns: table.columns.map((column) =>
                    column.id === "users-display-name"
                        ? { ...column, dataType: null as unknown as string }
                        : column,
                ),
            })),
        };

        const prismaResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.Prisma,
            schemaWithMissingType,
        );
        const typeOrmResult = generateSchemaDesignerDefinition(
            SchemaDesignerDefinitionFormat.TypeOrm,
            schemaWithMissingType,
        );

        expect(prismaResult).to.contain("displayName String?");
        expect(typeOrmResult).to.contain('type: "nvarchar"');
    });
});
