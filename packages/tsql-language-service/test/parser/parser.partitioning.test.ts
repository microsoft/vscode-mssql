import { parseOne, parseBody, parseResult, toSql } from "./parser.helpers";

describe("T-SQL Parser - partitioning and filegroups", () => {
    test("CREATE INDEX on filegroup", () => {
        const stmt = parseOne<any>(`
            CREATE INDEX ix_Records_CreatedOn
            ON dbo.Records (CreatedOn)
            ON [PRIMARY]
        `);

        expect(stmt.type).toBe("CreateIndexStatement");
        expect(stmt.storage.kind).toBe("FILEGROUP");
        expect(stmt.storage.name).toBe("[PRIMARY]");
    });

    test("CREATE INDEX on partition scheme", () => {
        const stmt = parseOne<any>(`
            CREATE UNIQUE NONCLUSTERED INDEX ix_Records_CreatedOn
            ON dbo.Records (CreatedOn DESC)
            WITH (ONLINE = ON)
            ON psCreatedOn (CreatedOn)
        `);

        expect(stmt.storage.kind).toBe("PARTITION_SCHEME");
        expect(stmt.storage.name).toBe("psCreatedOn");
        expect(stmt.storage.partitionColumn.name).toBe("CreatedOn");
    });

    test("CREATE TABLE on filegroup with TEXTIMAGE_ON", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE dbo.Documents (
                Id INT NOT NULL,
                Body VARCHAR(MAX) NULL
            )
            ON [PRIMARY]
            TEXTIMAGE_ON ArchiveGroup
        `);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("TABLE");
        expect(stmt.storage.kind).toBe("FILEGROUP");
        expect(stmt.storage.name).toBe("[PRIMARY]");
        expect(stmt.textImageOn.kind).toBe("FILEGROUP");
        expect(stmt.textImageOn.name).toBe("ArchiveGroup");
    });

    test("table constraint storage target is captured", () => {
        const stmt = parseOne<any>(`
            CREATE TABLE dbo.Events (
                EventId INT NOT NULL,
                EventDate DATE NOT NULL,
                PRIMARY KEY CLUSTERED (EventDate, EventId) ON psEvents(EventDate)
            )
        `);

        expect(stmt.constraints).toHaveLength(1);
        expect(stmt.constraints[0].kind).toBe("PRIMARY KEY");
        expect(stmt.constraints[0].storage.kind).toBe("PARTITION_SCHEME");
        expect(stmt.constraints[0].storage.name).toBe("psEvents");
        expect(stmt.constraints[0].storage.partitionColumn.name).toBe("EventDate");
    });

    test("CREATE PARTITION FUNCTION parses boundary metadata", () => {
        const stmt = parseOne<any>(`
            CREATE PARTITION FUNCTION pfCreatedOn (DATETIME2)
            AS RANGE RIGHT FOR VALUES ('2024-01-01', '2025-01-01')
        `);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("PARTITION_FUNCTION");
        expect(stmt.partitionInputType).toBe("DATETIME2");
        expect(stmt.partitionRange).toBe("RIGHT");
        expect(stmt.boundaryValues.map(toSql)).toEqual(["'2024-01-01'", "'2025-01-01'"]);
    });

    test("CREATE PARTITION SCHEME parses ALL TO filegroup list", () => {
        const stmt = parseOne<any>(`
            CREATE PARTITION SCHEME psCreatedOn
            AS pfCreatedOn ALL TO ([PRIMARY])
        `);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("PARTITION_SCHEME");
        expect(stmt.partitionFunction.name).toBe("pfCreatedOn");
        expect(stmt.allTo).toBe(true);
        expect(stmt.filegroups.map((x: any) => x.name)).toEqual(["[PRIMARY]"]);
    });

    test("CREATE PARTITION SCHEME parses optional PARTITION keyword before function name", () => {
        const stmt = parseOne<any>(`
            CREATE PARTITION SCHEME [SomeScheme]
            AS PARTITION [SomeFunction] ALL TO([PRIMARY])
        `);

        expect(stmt.type).toBe("CreateStatement");
        expect(stmt.objectType).toBe("PARTITION_SCHEME");
        expect(stmt.partitionFunction.name).toBe("[SomeFunction]");
        expect(stmt.allTo).toBe(true);
        expect(stmt.filegroups.map((x: any) => x.name)).toEqual(["[PRIMARY]"]);
    });

    test("partitioning batch parses without issues", () => {
        const sql = `
            CREATE PARTITION FUNCTION pfId (INT)
            AS RANGE LEFT FOR VALUES (100, 1000);

            CREATE PARTITION SCHEME psId
            AS pfId TO ([PRIMARY], [PRIMARY], [PRIMARY]);

            CREATE TABLE dbo.Records (
                Id INT NOT NULL,
                CreatedOn DATETIME2 NOT NULL
            )
            ON psId (Id);

            CREATE INDEX ix_Records_Id
            ON dbo.Records (Id)
            ON psId (Id);
        `;

        const result = parseResult(sql);

        expect(result.issues ?? []).toEqual([]);
        expect(parseBody(sql)).toHaveLength(4);
    });
});
