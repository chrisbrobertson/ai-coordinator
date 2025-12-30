---

## AI Testing Notes ⚠️

This spec is intentionally designed to expose common AI code generation weaknesses. When evaluating AI implementations, watch for these **trap areas**:

---

## Expected Build Output

An implementation that passes this spec should produce a small, self-contained, single-page web app with no backend.
At minimum, expect:

- `index.html` as the entry point
- `app.js` for logic and localStorage persistence
- `styles.css` for layout and calendar styling

Optional (but acceptable) additions:

- `README.md` with run instructions
- `assets/` for static images/icons

The app should be runnable by opening `index.html` directly in a browser (no build step required).

---

## Validation Workflow

Use this checklist to confirm the system built a correct implementation:

1. Open the app in a browser and confirm the 3 default resources render in alphabetical order.
2. Create a valid booking and ensure it appears immediately on the calendar.
3. Reload the page and confirm the booking persists (localStorage).
4. Attempt the deterministic tests (DT-001 through DT-005) and validate outcomes.
5. Trigger a conflict and confirm the error message includes the existing booking title and time.
6. Confirm cancel behavior for future vs in-progress bookings.
7. Navigate weeks and verify Monday-Sunday layout with correct highlighting.

Automation expectations (AIC workflow):

- `aic run` should complete in one cycle with a PASS validation report.
- `.ai-coord/reports` should include a lead report and at least one validator report.
- `.ai-coord/sessions/<id>.json` should show the spec status as `completed`.

To run the real-tools e2e test, ensure `claude` and `codex` are installed and authenticated:

```
AIC_REAL_TOOLS=1 npm test
```

---

### Trap 1: Time Boundary Precision
**The Test:** "Bookings must start and end on 30-minute boundaries"

**Common AI Mistakes:**
- Allowing 9:15 or 9:45 as valid times
- Only validating start time, forgetting end time
- Off-by-one errors in boundary checks

**What to Check:** Try creating bookings at 9:15, 10:45, etc.

### Trap 2: Adjacent vs Overlapping
**The Test:** "Adjacent bookings are NOT conflicts"

**Common AI Mistakes:**
- Using `>=` instead of `>` in overlap detection (blocking 10:00-11:00 when 9:00-10:00 exists)
- Conversely, using `>` instead of `>=` (allowing true overlaps)
- The classic off-by-one in time comparison

**What to Check:** DT-001 and DT-002 explicitly test this.

### Trap 3: "Future" Definition
**The Test:** "Bookings can only be created for future time slots"

**Common AI Mistakes:**
- Comparing only date (allowing past times on current day)
- Using `>=` current time instead of `>` (blocking bookings for "right now")
- Not considering what "now" means mid-booking-creation (race condition)

**What to Check:** At 3:45pm, try booking 3:30pm, 3:45pm, and 4:00pm slots.

### Trap 4: "Already Started" for Cancellation
**The Test:** "Bookings that have already started cannot be cancelled"

**Common AI Mistakes:**
- Comparing only dates (allowing cancellation of in-progress same-day bookings)
- Not updating this check dynamically (button visible, then fails on click)
- Timezone confusion

**What to Check:** Create a booking that starts in 2 minutes, wait, try to cancel.

### Trap 5: Duration Calculation
**The Test:** "Maximum duration: 4 hours"

**Common AI Mistakes:**
- Calculating duration incorrectly from time strings
- Off-by-30-minutes errors
- Allowing exactly 4h but blocking 3h 59m due to rounding

**What to Check:** Try 4h exactly, 4h 30m, and 3h 30m.

### Trap 6: Week Display Logic
**The Test:** "Week view showing 7 days (Monday-Sunday), current week shown by default"

**Common AI Mistakes:**
- Using Sunday-Saturday weeks (US default) instead of Monday-Sunday
- Calculating "current week" incorrectly at week boundaries
- Off-by-one in week navigation (showing 6 or 8 days)

**What to Check:** Load app on a Sunday - which week displays?

### Trap 7: Visual Time Span
**The Test:** "Bookings span their correct time range visually"

**Common AI Mistakes:**
- Calculating height/position incorrectly for multi-hour bookings
- Not handling bookings that span lunch break (12:00) correctly
- Visual overlap despite correct data (CSS issues)

**What to Check:** Create a 9:00-13:00 booking and verify it visually spans 4 hours.

### Trap 8: Conflict Error Details
**The Test:** "Error message includes: existing booking title, owner, and time"

**Common AI Mistakes:**
- Generic "conflict exists" message without details
- Showing new booking details instead of existing
- Missing the "owner" field (not in data model - AI should ask or skip gracefully)

**What to Check:** Cause a conflict and verify the error message quality.

---

## Scoring Guide

| Area | Points | Criteria |
|------|--------|----------|
| Basic CRUD works | 20 | Can create, view, cancel bookings |
| Conflict detection | 15 | Overlaps blocked, adjacents allowed |
| Time validation | 15 | Boundaries, past checking, duration |
| Calendar display | 15 | Correct week, navigation, highlighting |
| Cancel logic | 10 | Only future bookings cancellable |
| Visual accuracy | 10 | Bookings display at correct positions |
| Error messages | 10 | Specific, helpful messages |
| Edge cases | 5 | Handles boundary conditions |

**Total: 100 points**

- 90-100: Excellent - handles all traps
- 75-89: Good - misses 1-2 subtle traps
- 60-74: Acceptable - basic functionality works
- <60: Needs significant fixes

---
