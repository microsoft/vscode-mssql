/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { expect } from "chai";
import {
    evaluateVectorExpression,
    VECTOR_EXPRESSION_LIMITS,
    VectorExpressionBasket,
    VectorExpressionError,
    VectorExpressionErrorCode,
    validateVectorExpressionLocally,
} from "../../src/queryResults/vector/vectorExpression";

const f32 = (values: readonly number[]): Float32Array => Float32Array.from(values);

function expectVector(actual: Float32Array, expected: readonly number[], tolerance = 1e-6): void {
    expect(actual.length).to.equal(expected.length);
    for (let index = 0; index < expected.length; index++) {
        expect(actual[index]).to.be.closeTo(expected[index], tolerance);
    }
}

function expectExpressionError(
    code: VectorExpressionErrorCode,
    action: () => unknown,
): VectorExpressionError {
    try {
        action();
    } catch (error) {
        expect(error).to.be.instanceOf(VectorExpressionError);
        expect((error as VectorExpressionError).code).to.equal(code);
        return error as VectorExpressionError;
    }
    expect.fail(`Expected VectorExpressionError(${code}).`);
}

suite("vector expression core (VEC-6/VEC-8)", () => {
    const basket: VectorExpressionBasket = {
        A: f32([1, 0, 0]),
        B: f32([0, 1, 0]),
        C: f32([0, 0, 1]),
    };

    test("evaluates the documented normalize, weighted-sum, and centroid examples", () => {
        const normalized = evaluateVectorExpression("normalize(A + B - C)", basket);
        expectVector(normalized.values, [1 / Math.sqrt(3), 1 / Math.sqrt(3), -1 / Math.sqrt(3)]);
        expect(normalized.l2).to.be.closeTo(1, 1e-6);
        expect(normalized.symbols).to.deep.equal(["A", "B", "C"]);
        expect(normalized.operationCount).to.equal(3);

        const weighted = evaluateVectorExpression("0.7 * A + 0.3 * B", basket);
        expectVector(weighted.values, [0.7, 0.3, 0]);

        const centroid = evaluateVectorExpression("centroid(A, B, C)", basket);
        expectVector(centroid.values, [1 / 3, 1 / 3, 1 / 3]);
        expect(centroid.operationCount).to.equal(1);
    });

    test("honors precedence, parentheses, signed scientific scalars, and all normalization modes", () => {
        const result = evaluateVectorExpression("2e0 * A - 0.5 * (B + C)", basket);
        expectVector(result.values, [2, -0.5, -0.5]);

        const signed = evaluateVectorExpression("A + -2.5e-1 * B", basket);
        expectVector(signed.values, [1, -0.25, 0]);

        expectVector(
            evaluateVectorExpression("normalize(1 * A + 3 * B, norm1)", basket).values,
            [0.25, 0.75, 0],
        );
        expectVector(evaluateVectorExpression("normalize(1 * A + 3 * B, norminf)", basket).values, [
            1 / 3,
            1,
            0,
        ]);
    });

    test("returns float32 output and norms without aliasing caller vectors", () => {
        const source = f32([0.1, -0.2, 0.3]);
        const result = evaluateVectorExpression("A", { A: source });
        expect(result.values).to.be.instanceOf(Float32Array);
        expect(result.dimensions).to.equal(3);
        expect(result.l1).to.be.closeTo(0.6, 1e-6);
        expect(result.l2).to.be.closeTo(Math.sqrt(0.14), 1e-6);
        expect(result.linf).to.be.closeTo(0.3, 1e-6);

        result.values[0] = 99;
        expect(source[0]).to.be.closeTo(0.1, 1e-6);
    });

    test("rejects missing symbols, incompatible dimensions, and invalid source vectors", () => {
        expectExpressionError("unknownSymbol", () =>
            evaluateVectorExpression("A + B", { A: f32([1, 2]) }),
        );
        expectExpressionError("dimensionMismatch", () =>
            evaluateVectorExpression("A + B", { A: f32([1, 2]), B: f32([1, 2, 3]) }),
        );
        expectExpressionError("invalidVector", () => evaluateVectorExpression("A", { A: f32([]) }));
        expectExpressionError("invalidVector", () =>
            evaluateVectorExpression("A", {
                A: new Float32Array(VECTOR_EXPRESSION_LIMITS.maxDimensions + 1),
            }),
        );
        expectExpressionError("nonFinite", () =>
            evaluateVectorExpression("A", { A: [1, Number.NaN] }),
        );
        expectExpressionError("nonFinite", () =>
            evaluateVectorExpression("A", { A: [1, Number.POSITIVE_INFINITY] }),
        );
    });

    test("refuses zero-norm normalization for every supported norm", () => {
        for (const norm of ["norm1", "norm2", "norminf"] as const) {
            expectExpressionError("zeroNorm", () =>
                evaluateVectorExpression(`normalize(A, ${norm})`, { A: f32([0, 0]) }),
            );
        }
    });

    test("guards scalar, intermediate, and output float32 magnitudes", () => {
        expectExpressionError("magnitudeLimit", () =>
            evaluateVectorExpression("3.5e38 * A", { A: f32([1]) }),
        );
        expectExpressionError("magnitudeLimit", () =>
            evaluateVectorExpression("A + B", {
                A: [VECTOR_EXPRESSION_LIMITS.maxAbsComponent],
                B: [VECTOR_EXPRESSION_LIMITS.maxAbsComponent],
            }),
        );
        expectExpressionError("nonFinite", () =>
            evaluateVectorExpression("1e309 * A", { A: f32([1]) }),
        );
    });

    test("rejects unsupported syntax and identifier or property injection", () => {
        for (const expression of [
            "A * 2",
            "-A",
            "A / B",
            "A.constructor",
            "globalThis",
            "eval(A)",
            "Function(A)",
            "normalize(A, cosine)",
            "centroid(A)",
            "centroid(A + B, C)",
        ]) {
            const error = expectExpressionError("syntax", () =>
                evaluateVectorExpression(expression, basket),
            );
            expect(error.message).to.not.equal("");
        }
        expectExpressionError("unknownSymbol", () => evaluateVectorExpression("I", basket));
    });

    test("enforces UTF-8 byte, token, and nesting limits", () => {
        expectExpressionError("expressionTooLong", () =>
            evaluateVectorExpression("é".repeat(1_025), basket),
        );

        // 65 symbols + 64 plus signs = 129 lexical tokens.
        expectExpressionError("tooManyTokens", () =>
            evaluateVectorExpression(new Array(65).fill("A").join(" + "), basket),
        );

        const tooDeep = `${"(".repeat(VECTOR_EXPRESSION_LIMITS.maxDepth + 1)}A${")".repeat(VECTOR_EXPRESSION_LIMITS.maxDepth + 1)}`;
        expectExpressionError("nestingTooDeep", () => evaluateVectorExpression(tooDeep, basket));
    });

    test("centroid is bounded to the A-H basket and requires a closed argument list", () => {
        const all = Object.fromEntries(
            ["A", "B", "C", "D", "E", "F", "G", "H"].map((symbol, index) => [symbol, f32([index])]),
        ) as VectorExpressionBasket;
        expectVector(evaluateVectorExpression("centroid(A,B,C,D,E,F,G,H)", all).values, [3.5]);
        expectExpressionError("syntax", () =>
            evaluateVectorExpression("centroid(A,B,C,D,E,F,G,H,A)", all),
        );
        expectExpressionError("syntax", () => evaluateVectorExpression("centroid(A,B", all));
    });

    test("validates constrained editor syntax without result-derived components", () => {
        const validated = validateVectorExpressionLocally("normalize(0.7 * A + 0.3 * B)", [
            "A",
            "B",
        ]);
        expect(validated.symbols).to.deep.equal(["A", "B"]);
        expect(validated.operationCount).to.equal(4);

        expectExpressionError("unknownSymbol", () =>
            validateVectorExpressionLocally("A + C", ["A", "B"]),
        );
        expectExpressionError("syntax", () =>
            validateVectorExpressionLocally("A.constructor", ["A"]),
        );
    });

    test("local validation does not require the Node Buffer global", () => {
        const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Buffer");
        let symbols: readonly string[] | undefined;
        try {
            Object.defineProperty(globalThis, "Buffer", {
                configurable: true,
                enumerable: descriptor?.enumerable ?? false,
                writable: true,
                value: undefined,
            });
            symbols = validateVectorExpressionLocally("centroid(A, B)", ["A", "B"]).symbols;
        } finally {
            if (descriptor) {
                Object.defineProperty(globalThis, "Buffer", descriptor);
            } else {
                delete (globalThis as { Buffer?: unknown }).Buffer;
            }
        }
        expect(symbols).to.deep.equal(["A", "B"]);
    });
});
