# Examples

## Example 1: Single Spec
Create `specs/feature-hello.md`:
```markdown
---
specmas: v3
kind: FeatureSpec
id: feat-hello
name: Hello Feature
version: 1.0.0
complexity: EASY
maturity: 3
---

# Hello Feature

## Requirements
- Add a CLI command that prints "Hello, world".
```

Front matter must start at the first line (`---` at byte 0) or the spec will be ignored.

Run:
```bash
aic run
```

## Example 2: Multi-Spec With Dependencies
`specs/system-architecture.md` (context only):
```markdown
---
specmas: v3
kind: SystemSpec
id: sys-arch
name: System Architecture
version: 1.0.0
complexity: EASY
maturity: 3
---

# Architecture
- Shared auth utilities live in src/auth/
```

`specs/feature-auth.md`:
```markdown
---
specmas: v3
kind: FeatureSpec
id: feat-auth
name: Auth Feature
version: 1.0.0
complexity: MODERATE
maturity: 4
---

# Auth Feature
- Add login flow using shared auth utilities.
```

`specs/feature-dashboard.md`:
```markdown
---
specmas: v3
kind: FeatureSpec
id: feat-dashboard
name: Dashboard
version: 1.0.0
complexity: MODERATE
maturity: 4
depends_on: [feat-auth]
---

# Dashboard
- Show user info after login.
```

Run and preview ordering:
```bash
aic run --dry-run
aic run
```

## Example 3: Limiting Specs
```bash
aic run --specs "feature-*.md" --exclude "feature-dashboard.md"
```

## Example 4: Handling a Failure
1. Run:
   ```bash
   aic run --max-iterations 1
   ```
2. Open the validator report in `./.ai-coord/reports/`.
3. Fix the gaps and re-run.

## Example 5: Debugging Output
```bash
aic run --verbose --heartbeat 5
```
