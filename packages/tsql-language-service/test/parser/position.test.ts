import {
    createLineIndex,
    locationToRange,
    offsetToPosition,
    positionToOffset,
} from "../../src/parser/saral/index.js";

describe("position helpers", () => {
    test("converts offsets to zero-based positions for LF text", () => {
        const sql = "SELECT\n  Id\nFROM Users";

        expect(offsetToPosition(sql, 0)).toEqual({
            line: 0,
            character: 0,
        });

        expect(offsetToPosition(sql, sql.indexOf("Id"))).toEqual({
            line: 1,
            character: 2,
        });

        expect(offsetToPosition(sql, sql.indexOf("FROM"))).toEqual({
            line: 2,
            character: 0,
        });
    });

    test("converts positions to offsets for LF text", () => {
        const sql = "SELECT\n  Id\nFROM Users";

        expect(positionToOffset(sql, { line: 0, character: 0 })).toBe(0);
        expect(positionToOffset(sql, { line: 1, character: 2 })).toBe(sql.indexOf("Id"));
        expect(positionToOffset(sql, { line: 2, character: 0 })).toBe(sql.indexOf("FROM"));
    });

    test("handles CRLF line endings without exposing newline characters", () => {
        const sql = "SELECT\r\n  Id\r\nFROM Users";
        const index = createLineIndex(sql);

        expect(index.offsetToPosition(sql.indexOf("Id"))).toEqual({
            line: 1,
            character: 2,
        });

        expect(index.positionToOffset({ line: 1, character: 2 })).toBe(sql.indexOf("Id"));

        expect(index.positionToOffset({ line: 0, character: 999 })).toBe("SELECT".length);
    });

    test("clamps out-of-range offsets and positions", () => {
        const sql = "SELECT\nId";

        expect(offsetToPosition(sql, -100)).toEqual({
            line: 0,
            character: 0,
        });

        expect(offsetToPosition(sql, 100)).toEqual({
            line: 1,
            character: 2,
        });

        expect(positionToOffset(sql, { line: -1, character: -10 })).toBe(0);
        expect(positionToOffset(sql, { line: 99, character: 99 })).toBe(sql.length);
    });

    test("converts node locations to ranges", () => {
        const sql = "SELECT\n  Id\nFROM Users";

        expect(
            locationToRange(sql, {
                start: sql.indexOf("Id"),
                end: sql.indexOf("Id") + "Id".length,
            }),
        ).toEqual({
            start: { line: 1, character: 2 },
            end: { line: 1, character: 4 },
        });
    });
});
