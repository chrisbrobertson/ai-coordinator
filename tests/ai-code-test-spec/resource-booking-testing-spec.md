# Resource Booking App - Testing & Documentation Specification

---
specmas: v3
kind: FeatureSpec
id: feat-resource-booking-testing
name: Resource Booking Testing & Documentation
version: 1.0.0
owners:
  - name: Chris
complexity: EASY
maturity: 3
tags: [testing, documentation, qa, ai-evaluation]
related_specs: [feat-resource-booking]
---

## Overview

### Problem Statement
The Resource Booking App needs comprehensive testing to validate all functionality and edge cases, plus clear documentation so users and developers can understand, run, and maintain the application.

### Scope
**In Scope:**
- Unit tests for all business logic
- Integration tests for booking workflows
- End-to-end tests for critical paths
- README with setup and usage instructions
- Inline code documentation
- Test coverage requirements

**Out of Scope:**
- Performance/load testing
- Security penetration testing
- API documentation (no backend API)
- Video tutorials

### Success Metrics
- Test coverage ≥ 80% on business logic
- All deterministic tests from main spec pass
- README enables new developer setup in < 10 minutes
- Zero undocumented public functions

---

## Functional Requirements

### FR-1: Unit Test Suite
Unit tests covering all business logic functions in isolation.

**Required Test Files:**
```
tests/
├── unit/
│   ├── booking.test.ts       # Booking CRUD operations
│   ├── validation.test.ts    # Input validation logic
│   ├── conflict.test.ts      # Conflict detection algorithm
│   ├── time-utils.test.ts    # Time parsing and calculation
│   └── storage.test.ts       # localStorage operations
```

**Minimum Test Cases per Module:**

| Module | Min Tests | Key Scenarios |
|--------|-----------|---------------|
| booking | 8 | create, read, delete, list by resource, list by date |
| validation | 12 | all validation rules from main spec |
| conflict | 6 | overlap, adjacent, different resources, edge times |
| time-utils | 10 | parsing, duration calc, boundary checks, comparisons |
| storage | 5 | save, load, clear, handle corruption, size limits |

**Validation Criteria:**
- Each test has descriptive name explaining scenario
- Tests are independent (no shared state)
- Tests use realistic data, not "foo/bar"
- Failed tests provide clear error messages

### FR-2: Conflict Detection Tests
Dedicated test coverage for the conflict detection algorithm - the most error-prone area.

**Required Test Scenarios:**

```typescript
// These exact scenarios must have passing tests:

// Overlap cases (should detect conflict)
"9:00-10:00 conflicts with 9:30-10:30"    // Partial overlap end
"9:00-11:00 conflicts with 9:30-10:30"    // Contains entirely  
"9:30-10:30 conflicts with 9:00-10:00"    // Partial overlap start
"9:00-10:00 conflicts with 9:00-10:00"    // Exact match

// Non-conflict cases (should allow booking)
"9:00-10:00 does not conflict with 10:00-11:00"  // Adjacent after
"10:00-11:00 does not conflict with 9:00-10:00"  // Adjacent before
"9:00-10:00 does not conflict with 11:00-12:00"  // Gap between
"9:00-10:00 on room-a does not conflict with 9:00-10:00 on room-b"  // Different resource
"9:00-10:00 on 2025-01-15 does not conflict with 9:00-10:00 on 2025-01-16"  // Different day
```

**Validation Criteria:**
- All 9 scenarios above have explicit tests
- Tests use the actual conflict detection function (not mocked)
- Edge case at midnight boundary tested if applicable

### FR-3: Time Validation Tests
Tests ensuring time boundary and duration rules are enforced correctly.

**Required Test Scenarios:**

```typescript
// Valid times (30-min boundaries)
"08:00 is valid start time"
"08:30 is valid start time"
"17:30 is valid start time"  // Last valid start for 30-min booking
"18:00 is valid end time"    // Last valid end time

// Invalid times (not on boundary)
"08:15 is invalid - not on 30-min boundary"
"09:45 is invalid - not on 30-min boundary"
"10:01 is invalid - not on 30-min boundary"

// Out of range
"07:30 is invalid - before business hours"
"18:30 is invalid - after business hours"
"06:00 is invalid - way before hours"
"20:00 is invalid - way after hours"

// Duration validation
"30 minutes is valid (minimum)"
"4 hours is valid (maximum)"
"15 minutes is invalid (below minimum)"
"4 hours 30 minutes is invalid (above maximum)"
"0 minutes is invalid (no duration)"

// Start/end relationship
"end time before start time is invalid"
"end time equal to start time is invalid"
```

**Validation Criteria:**
- All scenarios above have explicit tests
- Error messages specify why time is invalid
- Both start and end times validated independently

### FR-4: Integration Tests
Tests that verify complete workflows across multiple modules.

**Required Test Files:**
```
tests/
├── integration/
│   ├── booking-workflow.test.ts   # Full create-view-cancel flow
│   ├── calendar-display.test.ts   # Data to UI rendering
│   └── persistence.test.ts        # Save/reload across sessions
```

**Required Workflow Tests:**

1. **Happy Path Booking:**
   - Load app → Select resource → Fill form → Submit → Verify on calendar → View details → Cancel → Verify removed

2. **Conflict Prevention:**
   - Create booking A → Attempt overlapping booking B → Verify error → Modify to non-overlapping → Success

3. **Persistence:**
   - Create bookings → Simulate page refresh (clear memory, reload from storage) → Verify bookings restored

4. **Week Navigation:**
   - Load current week → Navigate forward → Verify dates → Navigate back → Verify original dates

**Validation Criteria:**
- Workflows test realistic multi-step user journeys
- Tests verify both data state and UI state
- Cleanup after each test (no pollution)

### FR-5: End-to-End Tests
Browser-based tests verifying the complete application.

**Required Test File:**
```
tests/
├── e2e/
│   └── booking-app.e2e.ts    # Playwright or Cypress tests
```

**Required E2E Scenarios:**

| Test | Steps | Assertions |
|------|-------|------------|
| Page loads | Navigate to app | 3 resources visible, calendar renders |
| Create booking | Fill form, submit | Booking appears on calendar |
| Prevent conflict | Try overlapping booking | Error shown with details |
| Cancel booking | Click booking, cancel | Booking removed |
| Week navigation | Click next/prev | Dates update correctly |
| Past booking display | View past week | Bookings grayed out, no cancel button |

**Validation Criteria:**
- Tests run in actual browser (not jsdom)
- Tests wait for UI updates (no race conditions)
- Screenshots captured on failure
- Tests can run in CI environment (headless)

### FR-6: README Documentation
Comprehensive README.md at project root.

**Required Sections:**

```markdown
# Resource Booking App

## Overview
[2-3 sentence description]

## Features
- [Bullet list of key features]

## Quick Start
[Commands to get running in < 2 minutes]

## Prerequisites
- Node.js version
- npm/yarn version
- Browser requirements

## Installation
[Step-by-step commands]
$ git clone ...
$ cd ...
$ npm install

## Running the App
[Development mode command]
$ npm run dev

[Production build command]
$ npm run build
$ npm run preview

## Running Tests
[All test commands]
$ npm test              # All tests
$ npm run test:unit     # Unit only
$ npm run test:e2e      # E2E only
$ npm run test:coverage # With coverage report

## Project Structure
[Directory tree with explanations]

## Configuration
[Any config files/env vars]

## Usage Guide
[How to use the app - with screenshots or descriptions]
1. Select a resource from the list
2. Click on the calendar to start a booking
3. Fill in the booking details
4. ...

## Troubleshooting
[Common issues and solutions]

## License
[License info]
```

**Validation Criteria:**
- All sections present and filled in (no placeholders)
- Commands are copy-pasteable and work
- Relative links work (no broken links)
- No outdated information

### FR-7: Code Documentation
Inline documentation for all public functions and complex logic.

**Documentation Requirements:**

```typescript
/**
 * Checks if two bookings conflict (overlap in time for same resource).
 * 
 * Two bookings conflict if:
 * - They are for the same resource AND
 * - Their time ranges overlap (start < other.end AND end > other.start)
 * 
 * Adjacent bookings (one ends when another starts) are NOT conflicts.
 * 
 * @param booking1 - First booking to compare
 * @param booking2 - Second booking to compare
 * @returns true if bookings conflict, false otherwise
 * 
 * @example
 * // These conflict:
 * checkConflict(
 *   {resourceId: 'room-a', date: '2025-01-15', startTime: '09:00', endTime: '10:00'},
 *   {resourceId: 'room-a', date: '2025-01-15', startTime: '09:30', endTime: '10:30'}
 * ) // returns true
 * 
 * // These do NOT conflict (adjacent):
 * checkConflict(
 *   {resourceId: 'room-a', date: '2025-01-15', startTime: '09:00', endTime: '10:00'},
 *   {resourceId: 'room-a', date: '2025-01-15', startTime: '10:00', endTime: '11:00'}
 * ) // returns false
 */
function checkConflict(booking1: Booking, booking2: Booking): boolean
```

**Functions Requiring Full JSDoc:**
- `checkConflict()` - Conflict detection
- `validateBooking()` - Input validation
- `isValidTimeSlot()` - Time boundary checking
- `calculateDuration()` - Duration calculation
- `isBookingCancellable()` - Cancel eligibility check
- `getWeekDates()` - Week calculation for calendar
- `saveBookings()` / `loadBookings()` - Storage operations

**Validation Criteria:**
- All 7+ functions above have JSDoc with description, params, returns, example
- Complex algorithms have inline comments explaining logic
- No commented-out code left in place
- Type definitions documented if not self-explanatory

### FR-8: Test Coverage Requirements
Minimum coverage thresholds enforced in CI.

**Coverage Thresholds:**

| Metric | Minimum | Target |
|--------|---------|--------|
| Statements | 75% | 85% |
| Branches | 70% | 80% |
| Functions | 80% | 90% |
| Lines | 75% | 85% |

**Critical Paths (Must be 100%):**
- Conflict detection function
- Time validation function
- Booking creation flow
- Cancel eligibility check

**Coverage Exclusions Allowed:**
- Test files themselves
- Type definition files (.d.ts)
- Configuration files
- Index/barrel files with only exports

**Validation Criteria:**
- Coverage report generated on every test run
- CI fails if below minimum thresholds
- Coverage badge in README (optional but nice)

---

## Non-Functional Requirements

### Performance
- Unit tests complete in < 10 seconds
- Integration tests complete in < 30 seconds
- E2E tests complete in < 2 minutes
- Test startup time < 5 seconds

### Reliability & Scalability
- Tests are deterministic (no flaky tests)
- Tests can run in parallel (unit tests)
- Tests work on CI environments (GitHub Actions, etc.)

### Observability
- Test output shows clear pass/fail per test
- Failed tests show expected vs actual
- Coverage report viewable as HTML

### Compliance & Privacy
- No real user data in test fixtures
- Test data is clearly fake/generated

---

## Data Model

### Test Fixtures

```typescript
// Standard test fixtures for consistent testing

const TEST_RESOURCES: Resource[] = [
  { id: 'room-a', name: 'Conference Room A', capacity: 8 },
  { id: 'room-b', name: 'Conference Room B', capacity: 4 },
  { id: 'projector', name: 'Projector Kit', capacity: 1 }
];

const TEST_BOOKINGS: Booking[] = [
  {
    id: 'test-booking-1',
    resourceId: 'room-a',
    title: 'Morning Standup',
    date: '2025-01-15',
    startTime: '09:00',
    endTime: '09:30',
    createdAt: '2025-01-14T08:00:00Z'
  },
  {
    id: 'test-booking-2',
    resourceId: 'room-a',
    title: 'Sprint Planning',
    date: '2025-01-15',
    startTime: '10:00',
    endTime: '12:00',
    createdAt: '2025-01-14T08:30:00Z'
  },
  {
    id: 'test-booking-3',
    resourceId: 'room-b',
    title: 'Client Call',
    date: '2025-01-15',
    startTime: '14:00',
    endTime: '15:00',
    createdAt: '2025-01-14T09:00:00Z'
  }
];

// Factory functions for generating test data
function createTestBooking(overrides?: Partial<Booking>): Booking;
function createFutureDate(daysFromNow: number): string;
function createTimeSlot(hour: number, minute: 0 | 30): string;
```

---

## Interfaces & Contracts

### Test Runner Configuration

```javascript
// vitest.config.ts (or jest.config.js)
{
  testMatch: ['**/tests/**/*.test.ts'],
  coverage: {
    provider: 'v8',
    reporter: ['text', 'html', 'lcov'],
    exclude: ['tests/**', '*.config.*', 'src/types/**'],
    thresholds: {
      statements: 75,
      branches: 70,
      functions: 80,
      lines: 75
    }
  },
  setupFilesAfterEnv: ['./tests/setup.ts']
}
```

### E2E Configuration

```javascript
// playwright.config.ts
{
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 2,
  use: {
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure'
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: !process.env.CI
  }
}
```

---

## Deterministic Tests

```json
{
  "id": "DT-TEST-001",
  "description": "npm test command runs all tests and exits with 0 on success",
  "input": "npm test",
  "expected": "exit_code_0"
}
```

```json
{
  "id": "DT-TEST-002", 
  "description": "Coverage report generates without errors",
  "input": "npm run test:coverage",
  "expected": "coverage_html_generated"
}
```

```json
{
  "id": "DT-TEST-003",
  "description": "README contains all required sections",
  "input": "parse README.md for headings",
  "expected": ["Overview", "Quick Start", "Installation", "Running the App", "Running Tests", "Project Structure"]
}
```

```json
{
  "id": "DT-TEST-004",
  "description": "All JSDoc functions have @param, @returns, and @example",
  "input": "parse source files for function documentation",
  "expected": "all_required_functions_documented"
}
```

---

## Acceptance Tests

### User Stories

**Story 1:** As a developer, I want to run all tests with a single command, so that I can quickly verify the app works.

**Story 2:** As a new contributor, I want clear documentation, so that I can set up the project and understand the codebase quickly.

**Story 3:** As a maintainer, I want coverage thresholds enforced, so that test quality doesn't degrade over time.

### Acceptance Criteria

- [ ] Given I clone the repo, When I run `npm install && npm test`, Then all tests pass
- [ ] Given I run `npm run test:coverage`, When tests complete, Then I see coverage percentages for all metrics
- [ ] Given coverage is below threshold, When tests run in CI, Then the build fails
- [ ] Given I open README.md, When I follow Quick Start instructions, Then the app is running locally
- [ ] Given I look at any function in the critical path list, When I hover in my IDE, Then I see full JSDoc documentation
- [ ] Given an E2E test fails, When I check the test output, Then I find a screenshot of the failure

---

## Glossary & Definitions

- **Unit Test:** Tests a single function/module in isolation with mocked dependencies
- **Integration Test:** Tests multiple modules working together
- **E2E Test:** Tests the full application in a real browser
- **Coverage:** Percentage of code lines/branches executed during tests
- **Fixture:** Pre-defined test data used across multiple tests
- **Flaky Test:** A test that sometimes passes and sometimes fails without code changes

---

## Risks & Open Questions

### Risks
- **R-1:** E2E tests may be slow or flaky
  - **Impact:** Medium
  - **Mitigation:** Use Playwright with proper waits, limit E2E to critical paths

- **R-2:** Time-dependent tests may fail at certain times
  - **Impact:** High
  - **Mitigation:** Mock `Date.now()` in tests, use fixed test dates

### Open Questions
None - spec is complete for testing purposes.

---

## AI Testing Notes ⚠️

### Trap 1: Time Mocking
**The Test:** Tests involving "current time" comparisons

**Common AI Mistakes:**
- Not mocking Date.now(), causing tests to fail at certain times
- Mocking only in some tests, causing inconsistent behavior
- Using real dates that become "past" as time goes on

**What to Check:** Run tests at 5:30 PM - do any fail due to "past time" checks?

### Trap 2: Test Isolation
**The Test:** Tests should not affect each other

**Common AI Mistakes:**
- Shared localStorage between tests (pollution)
- Tests passing when run individually but failing together
- Order-dependent tests

**What to Check:** Run tests in random order, run a single test file in isolation.

### Trap 3: Async Handling in E2E
**The Test:** E2E tests waiting for UI updates

**Common AI Mistakes:**
- Using fixed `sleep(1000)` instead of proper waits
- Not waiting for animations/transitions to complete
- Race conditions between test and app

**What to Check:** Run E2E tests 10 times - any intermittent failures?

### Trap 4: Coverage Thresholds
**The Test:** Coverage must meet minimums

**Common AI Mistakes:**
- Setting up coverage but not enforcing thresholds
- Excluding too much code from coverage
- Thresholds configured but not failing CI

**What to Check:** Comment out a critical test - does coverage drop below threshold and fail?

### Trap 5: Documentation Completeness
**The Test:** README has all sections

**Common AI Mistakes:**
- Placeholder text left in ("TODO: add this")
- Commands that don't actually work
- Missing sections
- Outdated information

**What to Check:** Follow README from scratch on a clean machine.

---

**Status:** 🟢 Complete - Level 3
**Agent Ready:** ✅ Yes
**Required Level:** 3 (EASY)
**Estimated Implementation Time:** 3-5 hours
