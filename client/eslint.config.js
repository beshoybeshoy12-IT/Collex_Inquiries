import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';

/**
 * ESLint 9 flat config.
 *
 * JavaScript and JSX only — there is no TypeScript in this package by
 * deliberate constraint, so there is no type-aware linting to configure and
 * `rules-of-hooks` is doing most of the real work here.
 */
export default [
  { ignores: ['dist/**', 'node_modules/**'] },

  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,

      // A missing dependency is not a style question: it is a stale closure,
      // which in this app means a filter that silently stops updating or a
      // socket handler that forever sees the first render's token.
      'react-hooks/exhaustive-deps': 'error',

      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],

      // JSX components are PascalCase identifiers that the base rule cannot
      // see are "used"; the pattern also covers a deliberately ignored
      // destructured value.
      'no-unused-vars': [
        'error',
        {
          varsIgnorePattern: '^[A-Z_]',
          argsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
];
