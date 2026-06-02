import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "**/*.js",

      //
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: "module",
      },
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        module: "readonly",
        __dirname: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          args: "all",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-non-null-assertion": "warn",
      "@typescript-eslint/no-redundant-type-constituents": "off",
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: false }],
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/explicit-function-return-type": "off",
      "no-restricted-syntax": [
        "error",
        {
          selector: ":matches(FunctionDeclaration, FunctionExpression, ArrowFunctionExpression)[returnType]",
          message: "Avoid explicit return type annotations; prefer inference.",
        },
        {
          selector: "MethodDefinition[value.returnType]",
          message: "Avoid explicit return type annotations on methods; prefer inference.",
        },
        {
          selector: "Property[value.type=/Function/][value.returnType]",
          message: "Avoid explicit return type annotations on object methods; prefer inference.",
        },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-extra-boolean-cast": "warn",
      "no-unreachable": "error",
      "no-empty-pattern": "warn",
      "no-constant-condition": "warn",
      "no-undef": "off",
    },
  },
];
