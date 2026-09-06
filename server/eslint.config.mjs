// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettierRecommended from 'eslint-plugin-prettier/recommended';

/**
 * ESLint 9 flat config.
 *
 * Type-aware linting is on (`projectService`), which is slower than the
 * syntactic-only setup but is the only way the rules that matter here work at
 * all: `no-floating-promises` and `no-misused-promises` need the checker, and
 * both catch a class of bug this codebase is exposed to — an un-awaited Prisma
 * call inside an AsyncLocalStorage scope is exactly the failure that made
 * `runAsTenant` async in the first place.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'prisma/migrations/**'],
  },

  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettierRecommended,

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },

    rules: {
      // ── The rules that are actually load-bearing here ──────────────────
      // A dropped promise in a NestJS service is a write that silently did
      // not happen, and nothing surfaces it.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',

      // ── Deliberately relaxed, with reasons ─────────────────────────────
      // Prisma's `Json` columns and the DMMF are genuinely `any`. Forbidding
      // it outright would mean casting through `unknown` at every boundary,
      // which hides real type errors behind ceremony rather than fixing them.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',

      // An unused parameter named `_something` is documentation: it says what
      // the framework passes that this implementation does not need.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // Bilingual template strings interpolate enums and numbers constantly.
      '@typescript-eslint/restrict-template-expressions': 'off',

      // NestJS DTOs and decorators rely on empty interfaces / declaration
      // merging more than plain TypeScript does.
      '@typescript-eslint/no-empty-object-type': 'off',
    },
  },

  {
    // Specs mock aggressively and assert on shapes the checker cannot see.
    files: ['**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  {
    // The seed is a script: it logs to stdout on purpose, and that is its
    // entire user interface.
    files: ['prisma/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
);
