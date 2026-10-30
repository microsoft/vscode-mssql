/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Audited local vector-expression core. The grammar is deliberately small:
 * basket symbols A-H, addition/subtraction, scalar multiplication,
 * parentheses, normalize(), and centroid(). It parses and computes locally;
 * it never interprets JavaScript or accepts property/function injection.
 *
 * All arithmetic accumulates in float64. A successful result is rounded once
 * to float32 because that is the value a later Search operation will freeze
 * and serialize as SQL VECTOR data. Errors return no partial vector.
 */

export const VECTOR_EXPRESSION_LIMITS = Object.freeze({
    maxUtf8Bytes: 2 * 1024,
    maxTokens: 128,
    maxOperations: 64,
    maxDepth: 16,
    maxDimensions: 1_998,
    maxAbsComponent: 3.4028234663852886e38,
});

export const VECTOR_EXPRESSION_SYMBOLS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

export type VectorExpressionSymbol = (typeof VECTOR_EXPRESSION_SYMBOLS)[number];
export type VectorExpressionNorm = "norm1" | "norm2" | "norminf";
export type VectorExpressionValues = ArrayLike<number>;
export type VectorExpressionBasket = Readonly<
    Partial<Record<VectorExpressionSymbol, VectorExpressionValues>>
>;

export type VectorExpressionErrorCode =
    | "invalidInput"
    | "expressionTooLong"
    | "tooManyTokens"
    | "tooManyOperations"
    | "nestingTooDeep"
    | "syntax"
    | "unknownSymbol"
    | "invalidVector"
    | "dimensionMismatch"
    | "nonFinite"
    | "magnitudeLimit"
    | "zeroNorm";

export class VectorExpressionError extends Error {
    constructor(
        readonly code: VectorExpressionErrorCode,
        message: string,
        readonly position?: number,
    ) {
        super(message);
        this.name = "VectorExpressionError";
    }
}

export interface VectorExpressionResult {
    /** Complete float32 output; callers may transfer or copy it into a host registry. */
    readonly values: Float32Array;
    readonly dimensions: number;
    /** Basket symbols referenced by the expression, in first-use order. */
    readonly symbols: readonly VectorExpressionSymbol[];
    /** Binary operators, scalar multiplications, and function calls parsed. */
    readonly operationCount: number;
    /** Norms of the final float32 output, accumulated in float64. */
    readonly l1: number;
    readonly l2: number;
    readonly linf: number;
}

type TokenKind =
    | "plus"
    | "minus"
    | "star"
    | "leftParen"
    | "rightParen"
    | "comma"
    | "number"
    | "identifier"
    | "eof";

interface Token {
    readonly kind: TokenKind;
    readonly text: string;
    readonly position: number;
}

const NUMBER_PATTERN = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/;
const IDENTIFIER_START_PATTERN = /[A-Za-z_]/;
const IDENTIFIER_PART_PATTERN = /[A-Za-z0-9_]/;
const SYMBOL_SET = new Set<string>(VECTOR_EXPRESSION_SYMBOLS);

function fail(code: VectorExpressionErrorCode, message: string, position?: number): never {
    throw new VectorExpressionError(code, message, position);
}

function utf8ByteLength(value: string): number {
    let bytes = 0;
    for (const character of value) {
        const codePoint = character.codePointAt(0) ?? 0;
        bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    }
    return bytes;
}

function tokenize(expression: string): Token[] {
    if (utf8ByteLength(expression) > VECTOR_EXPRESSION_LIMITS.maxUtf8Bytes) {
        fail(
            "expressionTooLong",
            `Vector expressions are limited to ${VECTOR_EXPRESSION_LIMITS.maxUtf8Bytes} UTF-8 bytes.`,
        );
    }
    if (expression.trim().length === 0) {
        fail("invalidInput", "Enter a vector expression.", 0);
    }

    const tokens: Token[] = [];
    let position = 0;
    const add = (kind: TokenKind, text: string, at: number): void => {
        if (tokens.length >= VECTOR_EXPRESSION_LIMITS.maxTokens) {
            fail(
                "tooManyTokens",
                `Vector expressions are limited to ${VECTOR_EXPRESSION_LIMITS.maxTokens} tokens.`,
                at,
            );
        }
        tokens.push({ kind, text, position: at });
    };

    while (position < expression.length) {
        const character = expression[position];
        if (/\s/.test(character)) {
            position++;
            continue;
        }

        const singleCharacterKind: Partial<Record<string, TokenKind>> = {
            "+": "plus",
            "-": "minus",
            "*": "star",
            "(": "leftParen",
            ")": "rightParen",
            ",": "comma",
        };
        const kind = singleCharacterKind[character];
        if (kind) {
            add(kind, character, position);
            position++;
            continue;
        }

        if (/\d/.test(character) || character === ".") {
            const match = NUMBER_PATTERN.exec(expression.slice(position));
            if (!match) {
                fail("syntax", `Unexpected character "${character}".`, position);
            }
            add("number", match[0], position);
            position += match[0].length;
            continue;
        }

        if (IDENTIFIER_START_PATTERN.test(character)) {
            const start = position++;
            while (
                position < expression.length &&
                IDENTIFIER_PART_PATTERN.test(expression[position])
            ) {
                position++;
            }
            add("identifier", expression.slice(start, position), start);
            continue;
        }

        fail("syntax", `Unexpected character "${character}".`, position);
    }

    tokens.push({ kind: "eof", text: "", position: expression.length });
    return tokens;
}

class VectorExpressionParser {
    private readonly tokens: readonly Token[];
    private tokenIndex = 0;
    private depth = 0;
    private operations = 0;
    private dimensions: number | undefined;
    private readonly symbols: VectorExpressionSymbol[] = [];
    private readonly symbolSet = new Set<VectorExpressionSymbol>();
    private readonly vectors = new Map<VectorExpressionSymbol, Float64Array>();

    constructor(
        expression: string,
        private readonly basket: VectorExpressionBasket,
    ) {
        this.tokens = tokenize(expression);
    }

    parse(): VectorExpressionResult {
        const computed = this.parseSum();
        const trailing = this.peek();
        if (trailing.kind !== "eof") {
            fail("syntax", `Unexpected token "${trailing.text}".`, trailing.position);
        }
        if (computed.length === 0 || this.dimensions === undefined) {
            fail("invalidVector", "The expression produced no vector components.");
        }

        const values = new Float32Array(computed.length);
        let norm1 = 0;
        let norm2Squared = 0;
        let normInf = 0;
        for (let index = 0; index < computed.length; index++) {
            const component = this.checkedComponent(computed[index], trailing.position);
            const rounded = Math.fround(component);
            if (!Number.isFinite(rounded)) {
                fail(
                    "magnitudeLimit",
                    `Component ${index + 1} cannot be represented as float32.`,
                    trailing.position,
                );
            }
            values[index] = rounded;
            const absolute = Math.abs(rounded);
            norm1 += absolute;
            norm2Squared += rounded * rounded;
            normInf = Math.max(normInf, absolute);
        }

        return {
            values,
            dimensions: values.length,
            symbols: Object.freeze([...this.symbols]),
            operationCount: this.operations,
            l1: norm1,
            l2: Math.sqrt(norm2Squared),
            linf: normInf,
        };
    }

    private parseSum(): Float64Array {
        let left = this.parseProduct();
        while (this.peek().kind === "plus" || this.peek().kind === "minus") {
            const operator = this.consume();
            const right = this.parseProduct();
            this.countOperation(operator);
            if (left.length !== right.length) {
                fail(
                    "dimensionMismatch",
                    "All vectors in an expression must have identical dimensions.",
                    operator.position,
                );
            }
            const sign = operator.kind === "plus" ? 1 : -1;
            const output = new Float64Array(left.length);
            for (let index = 0; index < output.length; index++) {
                output[index] = this.checkedComponent(
                    left[index] + sign * right[index],
                    operator.position,
                );
            }
            left = output;
        }
        return left;
    }

    private parseProduct(): Float64Array {
        let scalarSign = 1;
        if (
            (this.peek().kind === "plus" || this.peek().kind === "minus") &&
            this.peek(1).kind === "number"
        ) {
            scalarSign = this.consume().kind === "minus" ? -1 : 1;
        }
        if (this.peek().kind !== "number") {
            if (scalarSign !== 1) {
                const token = this.peek();
                fail(
                    "syntax",
                    "Unary signs apply only to scalar multipliers; use -1 * A for a vector.",
                    token.position,
                );
            }
            return this.parsePrimary();
        }

        const scalarToken = this.consume();
        const scalar = scalarSign * Number(scalarToken.text);
        if (!Number.isFinite(scalar)) {
            fail("nonFinite", "Scalar multipliers must be finite.", scalarToken.position);
        }
        if (Math.abs(scalar) > VECTOR_EXPRESSION_LIMITS.maxAbsComponent) {
            fail(
                "magnitudeLimit",
                "The scalar multiplier exceeds the float32 magnitude limit.",
                scalarToken.position,
            );
        }
        const star = this.expect(
            "star",
            "A numeric literal must be followed by * and a vector expression.",
        );
        const vector = this.parsePrimary();
        this.countOperation(star);
        const output = new Float64Array(vector.length);
        for (let index = 0; index < output.length; index++) {
            output[index] = this.checkedComponent(vector[index] * scalar, scalarToken.position);
        }
        return output;
    }

    private parsePrimary(): Float64Array {
        const token = this.peek();
        if (token.kind === "leftParen") {
            this.consume();
            return this.withNesting(token.position, () => {
                const value = this.parseSum();
                this.expect("rightParen", "Expected ) to close the vector expression.");
                return value;
            });
        }
        if (token.kind !== "identifier") {
            fail(
                "syntax",
                "Expected a basket symbol, parenthesized expression, normalize(), or centroid().",
                token.position,
            );
        }

        this.consume();
        if (SYMBOL_SET.has(token.text)) {
            return this.resolveSymbol(token.text as VectorExpressionSymbol, token.position);
        }
        if (token.text === "normalize") {
            return this.parseNormalize(token);
        }
        if (token.text === "centroid") {
            return this.parseCentroid(token);
        }
        if (/^[A-Za-z]$/.test(token.text)) {
            fail(
                "unknownSymbol",
                `Unknown basket symbol "${token.text}"; use A through H.`,
                token.position,
            );
        }
        fail(
            "syntax",
            `Unknown vector-expression function or identifier "${token.text}".`,
            token.position,
        );
    }

    private parseNormalize(functionToken: Token): Float64Array {
        const leftParen = this.expect("leftParen", "normalize must be followed by (.");
        return this.withNesting(leftParen.position, () => {
            const value = this.parseSum();
            let norm: VectorExpressionNorm = "norm2";
            if (this.peek().kind === "comma") {
                this.consume();
                const normToken = this.expect(
                    "identifier",
                    "normalize's optional norm must be norm1, norm2, or norminf.",
                );
                if (
                    !(["norm1", "norm2", "norminf"] as const).includes(
                        normToken.text as VectorExpressionNorm,
                    )
                ) {
                    fail(
                        "syntax",
                        "normalize's optional norm must be norm1, norm2, or norminf.",
                        normToken.position,
                    );
                }
                norm = normToken.text as VectorExpressionNorm;
            }
            this.expect("rightParen", "Expected ) to close normalize().");
            this.countOperation(functionToken);

            const denominator = this.norm(value, norm);
            if (denominator === 0) {
                fail("zeroNorm", `Cannot normalize a zero-${norm} vector.`, functionToken.position);
            }
            const output = new Float64Array(value.length);
            for (let index = 0; index < output.length; index++) {
                output[index] = this.checkedComponent(
                    value[index] / denominator,
                    functionToken.position,
                );
            }
            return output;
        });
    }

    private parseCentroid(functionToken: Token): Float64Array {
        const leftParen = this.expect("leftParen", "centroid must be followed by (.");
        return this.withNesting(leftParen.position, () => {
            const vectors: Float64Array[] = [];
            for (;;) {
                const symbolToken = this.expect(
                    "identifier",
                    "centroid accepts two to eight basket symbols (A through H).",
                );
                if (!SYMBOL_SET.has(symbolToken.text)) {
                    fail(
                        "unknownSymbol",
                        `Unknown basket symbol "${symbolToken.text}"; use A through H.`,
                        symbolToken.position,
                    );
                }
                vectors.push(
                    this.resolveSymbol(
                        symbolToken.text as VectorExpressionSymbol,
                        symbolToken.position,
                    ),
                );
                if (vectors.length > VECTOR_EXPRESSION_SYMBOLS.length) {
                    fail(
                        "syntax",
                        "centroid accepts at most eight basket symbols.",
                        symbolToken.position,
                    );
                }
                if (this.peek().kind !== "comma") {
                    break;
                }
                this.consume();
            }
            if (vectors.length < 2) {
                fail(
                    "syntax",
                    "centroid requires at least two basket symbols.",
                    functionToken.position,
                );
            }
            this.expect("rightParen", "Expected ) to close centroid().");
            this.countOperation(functionToken);

            // Incremental mean avoids a large transient sum while preserving
            // float64 accumulation and one magnitude check on the true output.
            const output = vectors[0].slice();
            for (let vectorIndex = 1; vectorIndex < vectors.length; vectorIndex++) {
                const vector = vectors[vectorIndex];
                const count = vectorIndex + 1;
                for (let component = 0; component < output.length; component++) {
                    output[component] += (vector[component] - output[component]) / count;
                }
            }
            for (let component = 0; component < output.length; component++) {
                output[component] = this.checkedComponent(
                    output[component],
                    functionToken.position,
                );
            }
            return output;
        });
    }

    private resolveSymbol(symbol: VectorExpressionSymbol, position: number): Float64Array {
        const cached = this.vectors.get(symbol);
        if (cached) {
            return cached;
        }
        if (!Object.prototype.hasOwnProperty.call(this.basket, symbol)) {
            fail("unknownSymbol", `Basket vector ${symbol} is not available.`, position);
        }
        const source = this.basket[symbol];
        const length = source?.length;
        if (
            source === undefined ||
            !Number.isInteger(length) ||
            length === undefined ||
            length < 1 ||
            length > VECTOR_EXPRESSION_LIMITS.maxDimensions
        ) {
            fail(
                "invalidVector",
                `Basket vector ${symbol} must have 1 to ${VECTOR_EXPRESSION_LIMITS.maxDimensions} components.`,
                position,
            );
        }
        if (this.dimensions !== undefined && this.dimensions !== length) {
            fail(
                "dimensionMismatch",
                `Basket vector ${symbol} has ${length} dimensions; expected ${this.dimensions}.`,
                position,
            );
        }

        const vector = new Float64Array(length);
        for (let index = 0; index < length; index++) {
            const component = source[index];
            if (typeof component !== "number" || !Number.isFinite(component)) {
                fail(
                    "nonFinite",
                    `Basket vector ${symbol} contains a non-finite component at position ${index + 1}.`,
                    position,
                );
            }
            vector[index] = this.checkedComponent(component, position);
        }

        this.dimensions = length;
        this.vectors.set(symbol, vector);
        if (!this.symbolSet.has(symbol)) {
            this.symbolSet.add(symbol);
            this.symbols.push(symbol);
        }
        return vector;
    }

    private norm(vector: Float64Array, norm: VectorExpressionNorm): number {
        let sum = 0;
        let maximum = 0;
        for (const component of vector) {
            const absolute = Math.abs(component);
            if (norm === "norm1") {
                sum += absolute;
            } else if (norm === "norm2") {
                sum += component * component;
            } else {
                maximum = Math.max(maximum, absolute);
            }
        }
        return norm === "norm2" ? Math.sqrt(sum) : norm === "norm1" ? sum : maximum;
    }

    private checkedComponent(value: number, position: number): number {
        if (!Number.isFinite(value)) {
            fail("nonFinite", "Vector arithmetic produced a non-finite component.", position);
        }
        if (Math.abs(value) > VECTOR_EXPRESSION_LIMITS.maxAbsComponent) {
            fail(
                "magnitudeLimit",
                "Vector arithmetic exceeded the float32 component magnitude limit.",
                position,
            );
        }
        return value;
    }

    private countOperation(token: Token): void {
        this.operations++;
        if (this.operations > VECTOR_EXPRESSION_LIMITS.maxOperations) {
            fail(
                "tooManyOperations",
                `Vector expressions are limited to ${VECTOR_EXPRESSION_LIMITS.maxOperations} operations.`,
                token.position,
            );
        }
    }

    private withNesting<T>(position: number, callback: () => T): T {
        if (this.depth >= VECTOR_EXPRESSION_LIMITS.maxDepth) {
            fail(
                "nestingTooDeep",
                `Vector expressions are limited to ${VECTOR_EXPRESSION_LIMITS.maxDepth} nested groups.`,
                position,
            );
        }
        this.depth++;
        try {
            return callback();
        } finally {
            this.depth--;
        }
    }

    private peek(offset = 0): Token {
        return this.tokens[Math.min(this.tokenIndex + offset, this.tokens.length - 1)];
    }

    private consume(): Token {
        const token = this.peek();
        if (token.kind !== "eof") {
            this.tokenIndex++;
        }
        return token;
    }

    private expect(kind: TokenKind, message: string): Token {
        const token = this.peek();
        if (token.kind !== kind) {
            fail("syntax", message, token.position);
        }
        return this.consume();
    }
}

/**
 * Parse and evaluate one constrained vector expression against a host-owned
 * basket. The basket is read synchronously and copied; a returned result has
 * no alias to the caller's component arrays.
 */
export function evaluateVectorExpression(
    expression: string,
    basket: VectorExpressionBasket,
): VectorExpressionResult {
    if (typeof expression !== "string" || basket === null || typeof basket !== "object") {
        fail("invalidInput", "A vector expression and basket are required.");
    }
    return new VectorExpressionParser(expression, basket).parse();
}

/**
 * Browser-safe syntax check for the constrained editor. It intentionally uses
 * synthetic orthogonal vectors: the host still rereads the real result rows
 * and evaluates again before any SQL is built. No result-derived component is
 * transferred to, cached by, or computed in the renderer.
 */
export function validateVectorExpressionLocally(
    expression: string,
    availableSymbols: readonly VectorExpressionSymbol[],
): Pick<VectorExpressionResult, "symbols" | "operationCount"> {
    const dimensions = VECTOR_EXPRESSION_SYMBOLS.length;
    const basket: Partial<Record<VectorExpressionSymbol, Float32Array>> = {};
    for (const symbol of availableSymbols) {
        if (!SYMBOL_SET.has(symbol)) {
            fail("unknownSymbol", `Unknown basket symbol "${symbol}"; use A through H.`);
        }
        const vector = new Float32Array(dimensions);
        vector[VECTOR_EXPRESSION_SYMBOLS.indexOf(symbol)] = 1;
        basket[symbol] = vector;
    }
    const result = evaluateVectorExpression(expression, basket);
    return { symbols: result.symbols, operationCount: result.operationCount };
}
