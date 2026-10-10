// SPDX-License-Identifier: GPL-3.0-or-later
import tseslint from "typescript-eslint";

export default tseslint.config(
    { ignores: ["dist/**", ".cache/**", "node_modules/**"] },
    ...tseslint.configs.recommended,
    {
        files: ["**/*.ts", "**/*.tsx"],
        rules: {
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
        },
    },
);
