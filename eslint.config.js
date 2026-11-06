import eslint from '@eslint/js';

export default [
  eslint.configs.recommended,
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        Buffer: 'readonly',
        console: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        FormData: 'readonly',
        Blob: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortSignal: 'readonly',
        fetch: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        document: 'readonly',
        window: 'readonly',
        localStorage: 'readonly',
        location: 'readonly',
        history: 'readonly',
        Node: 'readonly',
        setTimeout: 'readonly',
        navigator: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-console': 'off',
      'eqeqeq': ['error', 'always'],
      'curly': ['error', 'all'],
      'no-undef': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.test.js', 'test/run.mjs', 'test/ui-smoke.mjs'],
    rules: {
      'no-console': 'off',
      'no-undef': 'off',
      'curly': 'off',
    },
    languageOptions: {
      globals: {
        document: 'readonly',
        window: 'readonly',
        process: 'readonly',
        console: 'readonly',
      },
    },
  },
];
