# Repository Guidelines

## Project Structure & Module Organization
- `specs/` holds Spec-MAS markdown files that define the product; treat these as source of truth.
- Intended runtime layout (per spec): `src/` for TypeScript sources, `dist/` for compiled output, and `templates/` for starter spec files.
- Global state and reports are written outside the repo under `~/.ai-spec-coordinator/` and should not be committed.

## Build, Test, and Development Commands
- `npm run build` compiles TypeScript into `dist/`.
- `npm run dev` runs `tsc --watch` for local development.
- `npm run start` executes the compiled CLI from `dist/cli/index.js`.
- `npm run lint` runs ESLint against `src/`.
- `npm test` runs the Vitest suite.

## Coding Style & Naming Conventions
- Use TypeScript and follow ESLint guidance; keep code readable and avoid implicit `any`.
- Prefer file and directory names in kebab-case (e.g., `spec-queue.ts`, `feat-auth.md`).
- CLI entry points live under `src/cli/` and should remain thin wrappers around core modules.

## Testing Guidelines
- Tests use Vitest; place unit tests near their modules or under a dedicated `tests/` folder if introduced later.
- Use descriptive test names that mirror spec requirements (e.g., "detects tools on PATH").
- No explicit coverage target is defined; ensure critical orchestration paths are exercised.

## Commit & Pull Request Guidelines
- No commit message standard is defined in this repo yet; use clear, imperative subjects (e.g., "Add spec discovery ordering").
- PRs should describe the spec change or feature, note any CLI behavior updates, and include examples (commands or output) when relevant.

## Security & Configuration Tips
- Do not check in local state (`.ai-coord`, session files, or logs). Add ignores if they appear.
- CLI adapters should respect read-only vs. full-access execution modes described in the specs.

## Agent-Specific Instructions
- When updating behavior, align with the requirements in `specs/spec-ai-coordinator.md` and keep examples in sync.
