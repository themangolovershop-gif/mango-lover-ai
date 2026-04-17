# Skill: Run and Debug Tests

This skill provides instructions for maintaining the project's test suite.

## Tools
- **Vitest**: The primary testing framework.
- **Command**: `npm test` or `npx vitest`.

## Workflows

### 1. New Feature
- When implementing a new sales transition, add a corresponding test case in `src/lib/sales.test.ts`.

### 2. Regression Testing
- Always run `npm test` before pushing changes to ensure core logic (like signature verification or sales state transitions) is not broken.

### 3. Debugging
- Use `console.log` or the VS Code debugger to trace state changes in `sales.ts` when a test fails.
