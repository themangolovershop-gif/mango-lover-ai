# Skill: Fix Lint and Spell Check

This skill provides instructions for automatically resolving common linting and spell-check issues in the project.

## Strategies

### 1. Unknown Word / Spelling Issues
- If a word is a project-specific term (e.g., `supabase`, `WABA`, `pincode`), add it to the `cspell.json` file in the root.
- If a word is a Hindi/Hinglish term used in the sales flow (e.g., `kitna`, `bhav`), add it to the `cspell.json`.
- Do NOT fix spelling in actual user-facing content unless it is objectively wrong in that context.

### 2. Linting Errors
- Run `npm run lint` to identify errors.
- Use `npx eslint --fix .` for automatic fixes.
- For architectural violations, refer to the code conventions in `AGENTS.md`.

## Automatic Trigger
Mentions of `eslint`, `lint`, or `spell check` should trigger this skill.
