import { parseOne, parseBody } from "./parser.helpers";

describe("T-SQL Parser - Transactions", () => {
    test("BEGIN TRANSACTION", () => {
        const stmt = parseOne<any>(`
            BEGIN TRANSACTION
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("BEGIN");
    });

    test("BEGIN TRAN name", () => {
        const stmt = parseOne<any>(`
            BEGIN TRAN MyTran
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("BEGIN");

        expect(stmt.name).toBe("MyTran");
    });

    test("BEGIN DISTRIBUTED TRANSACTION", () => {
        const stmt = parseOne<any>(`
            BEGIN DISTRIBUTED TRANSACTION
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("BEGIN");

        expect(stmt.distributed).toBe(true);
    });

    test("BEGIN DISTRIBUTED TRANSACTION with name", () => {
        const stmt = parseOne<any>(`
            BEGIN DISTRIBUTED TRANSACTION DistTran
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("BEGIN");

        expect(stmt.distributed).toBe(true);

        expect(stmt.name).toBe("DistTran");
    });

    test("COMMIT", () => {
        const stmt = parseOne<any>(`
            COMMIT
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("COMMIT");
    });

    test("COMMIT TRANSACTION name", () => {
        const stmt = parseOne<any>(`
            COMMIT TRANSACTION MyTran
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("COMMIT");

        expect(stmt.name).toBe("MyTran");
    });

    test("ROLLBACK", () => {
        const stmt = parseOne<any>(`
            ROLLBACK
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("ROLLBACK");
    });

    test("ROLLBACK TRAN name", () => {
        const stmt = parseOne<any>(`
            ROLLBACK TRAN SavePoint1
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("ROLLBACK");

        expect(stmt.name).toBe("SavePoint1");
    });

    test("SAVE TRANSACTION savepoint", () => {
        const stmt = parseOne<any>(`
            SAVE TRANSACTION BeforeUpdate
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("SAVE");

        expect(stmt.name).toBe("BeforeUpdate");
    });

    test("SAVE TRAN requires name", () => {
        const stmt = parseOne<any>(`
            SAVE TRANSACTION
        `);

        expect(stmt.type).toBe("TransactionStatement");

        expect(stmt.action).toBe("SAVE");

        expect(stmt.incomplete).toBe(true);
    });

    test("continues after malformed SAVE TRAN", () => {
        const body = parseBody(`
            SAVE TRANSACTION;
            SELECT 1;
        `);

        expect(body.length).toBeGreaterThanOrEqual(2);

        expect(body[0].type).toBe("TransactionStatement");

        expect(body[1].type).toBe("SelectStatement");
    });

    test("transaction batch", () => {
        const body = parseBody(`
            BEGIN TRAN T1;
            UPDATE Users SET Name = 'A';
            COMMIT TRAN T1;
        `);

        expect(body).toHaveLength(3);

        expect(body[0].type).toBe("TransactionStatement");

        expect(body[1].type).toBe("UpdateStatement");

        expect(body[2].type).toBe("TransactionStatement");
    });
});
