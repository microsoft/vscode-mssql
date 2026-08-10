import { Lexer } from "../../src/parser/saral/parser/lexer.js";
import { Parser } from "../../src/parser/saral/parser/parser.js";

import {
    findNodeAt,
    collectNodes,
    findParent,
    findFirst,
} from "../../src/parser/saral/ast/astWalker.js";

import {
    type IdentifierNode,
    type SelectNode,
    type Program,
} from "../../src/parser/saral/ast/types.js";

// ---------------------------------------------
// Correct parse helper (returns Program directly)
// ---------------------------------------------
const parse = (sql: string): Program => {
    const lexer = new Lexer(sql);
    const parser = new Parser(lexer);
    return parser.parse().ast;
};

describe("AST Walker", () => {
    // ---------------------------------------------
    // findNodeAt
    // ---------------------------------------------
    test("findNodeAt finds identifier", () => {
        const sql = `SELECT Id FROM Users`;
        const ast = parse(sql);

        const offset = sql.indexOf("Id");

        const node = findNodeAt(ast, offset);

        expect(node).not.toBeNull();
        expect(node!.type).toBe("Identifier");
        expect((node as IdentifierNode).name).toBe("Id");
    });

    test("findNodeAt finds nested expression", () => {
        const sql = `SELECT Id + 1 FROM Users`;
        const ast = parse(sql);

        const offset = sql.indexOf("1");

        const node = findNodeAt(ast, offset);

        expect(node).not.toBeNull();
        expect(node!.type).toBe("Literal");
    });

    test("findNodeAt returns null outside range", () => {
        const sql = `SELECT Id FROM Users`;
        const ast = parse(sql);

        const node = findNodeAt(ast, 9999);

        expect(node).toBeNull();
    });

    // ---------------------------------------------
    // collectNodes
    // ---------------------------------------------
    test("collectNodes collects identifiers", () => {
        const sql = `SELECT Id, Name FROM Users`;
        const ast = parse(sql);

        const ids = collectNodes(ast, (n): n is IdentifierNode => n.type === "Identifier");

        const names = ids.map((i) => i.name);

        expect(names).toContain("Id");
        expect(names).toContain("Name");
        expect(names).toContain("Users");
    });

    test("collectNodes collects select statements", () => {
        const sql = `
            SELECT Id FROM Users;
            SELECT Name FROM Customers;
        `;
        const ast = parse(sql);

        const selects = collectNodes(ast, (n): n is SelectNode => n.type === "SelectStatement");

        expect(selects.length).toBe(2);
    });

    // ---------------------------------------------
    // findParent
    // ---------------------------------------------
    test("findParent returns correct parent", () => {
        const sql = `SELECT Id FROM Users`;
        const ast = parse(sql);

        const ids = collectNodes(ast, (n): n is IdentifierNode => n.type === "Identifier");

        const idNode = ids.find((n) => n.name === "Id")!;

        const parent = findParent(ast, idNode);

        expect(parent).not.toBeNull();
        expect(parent!.type).toBe("Column");
    });

    // ---------------------------------------------
    // findFirst
    // ---------------------------------------------
    test("findFirst returns first matching node", () => {
        const sql = `
            SELECT Id FROM Users;
            SELECT Name FROM Customers;
        `;
        const ast = parse(sql);

        const firstSelect = findFirst(ast, (n): n is SelectNode => n.type === "SelectStatement");

        expect(firstSelect).not.toBeNull();
        expect(firstSelect!.type).toBe("SelectStatement");
    });

    // ---------------------------------------------
    // robustness
    // ---------------------------------------------
    test("walker handles incomplete AST gracefully", () => {
        const sql = `SELECT FROM`; // broken SQL
        const ast = parse(sql);

        const nodes = collectNodes(ast, (n): n is IdentifierNode => n.type === "Identifier");

        expect(Array.isArray(nodes)).toBe(true);
    });
});
