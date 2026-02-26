import tseslint from "typescript-eslint";

export default [
    {
        files: ["**/*.ts"],
    },
    {
        plugins: {
            "@typescript-eslint": tseslint.plugin,
        },

        languageOptions: {
            parser: tseslint.parser,
            ecmaVersion: 2022,
            sourceType: "module",
        },

        rules: {
            "@typescript-eslint/naming-convention": [
                "warn",
                {
                    selector: "import",
                    format: ["camelCase", "PascalCase"],
                },
            ],

            curly: "warn",
            eqeqeq: "warn",
            "no-throw-literal": "warn",
            semi: "warn",
        },
    },
];
