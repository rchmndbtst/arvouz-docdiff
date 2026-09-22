import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';

export default [
  { ignores: ['dist/**', 'node_modules/**', '*.vsix'] },
  eslint.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module' },
      globals: {
        acquireVsCodeApi: 'readonly',
        console: 'readonly',
        process: 'readonly',
        document: 'readonly',
        window: 'readonly',
        TextEncoder: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        Buffer: 'readonly',
        HTMLElement: 'readonly',
        HTMLButtonElement: 'readonly',
        MessageEvent: 'readonly',
        ArrayBuffer: 'readonly',
        Uint8Array: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'always'],
      curly: ['error', 'all'],
    },
  },
];
