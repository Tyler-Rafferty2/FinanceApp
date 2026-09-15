import { defineConfig } from 'vitest/config'

// Default `vitest run` only picks up unit tests — integration tests live
// under src/integration and are run separately via `npm run test:integration`
// since they hit the real deployed API and need real Cognito credentials.
export default defineConfig({
    test: {
        exclude: ['**/node_modules/**', '**/dist/**', 'src/integration/**'],
    },
})
