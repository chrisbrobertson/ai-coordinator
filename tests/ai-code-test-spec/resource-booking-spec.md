---
specmas: v3
kind: FeatureSpec
id: feat-resource-booking
name: Simple Resource Booking App
version: 1.0.0
owners:
  - name: Chris
complexity: EASY
maturity: 3
tags: [webapp, booking, testing, ai-evaluation]
---

# Simple Resource Booking App - Specification

## Overview

### Problem Statement
Small teams need a simple way to book shared resources (meeting rooms, equipment, vehicles) without double-booking conflicts. Current solutions are either too complex or require manual coordination via chat/email.

### Scope
**In Scope:**
- Single-page webapp for booking resources
- View resource availability calendar
- Create, view, and cancel bookings
- Basic conflict prevention
- Simple in-memory or SQLite persistence

**Out of Scope:**
- User authentication (single-user/team assumed)
- Recurring bookings
- Notifications/reminders
- Mobile-specific UI
- Multi-tenancy

### Success Metrics
- User can create a booking in under 30 seconds
- Zero double-booking conflicts occur
- Calendar view loads in < 500ms

---

## Functional Requirements

### FR-1: Resource Management
The app displays a fixed list of 3 bookable resources. Resources are pre-configured (no CRUD needed).

**Default Resources:**
1. "Conference Room A" (capacity: 8)
2. "Conference Room B" (capacity: 4)  
3. "Projector Kit" (capacity: 1)

**Validation Criteria:**
- All 3 resources appear on initial page load
- Each resource shows its name and capacity
- Resources are displayed in alphabetical order

### FR-2: Calendar View
Users can view a weekly calendar showing bookings for each resource.

**Display Requirements:**
- Week view showing 7 days (Monday-Sunday)
- Current week shown by default
- Navigation to previous/next weeks
- Each booking shows: title, time range, and a visual block on the calendar
- Time slots displayed in 30-minute increments from 8:00 AM to 6:00 PM

**Validation Criteria:**
- Current day is visually highlighted
- Bookings span their correct time range visually
- Past bookings appear grayed out
- Week navigation updates the displayed dates

### FR-3: Create Booking
Users can create a new booking by selecting a resource, date, start time, end time, and title.

**Booking Constraints:**
- Minimum duration: 30 minutes
- Maximum duration: 4 hours
- Bookings must start and end on 30-minute boundaries (e.g., 9:00, 9:30, 10:00)
- Bookings can only be created for future time slots
- Title is required (1-50 characters)

**Validation Criteria:**
- Form validates all constraints before submission
- Error messages are specific (not generic "invalid input")
- Successful booking appears immediately on calendar
- Form resets after successful booking

### FR-4: Conflict Detection
The system prevents double-booking of any resource.

**Conflict Rules:**
- Two bookings conflict if they overlap for the same resource
- Adjacent bookings (one ends when another starts) are NOT conflicts
- Attempting to create a conflicting booking shows an error with the conflicting booking's details

**Validation Criteria:**
- Conflict check happens before booking is saved
- Error message includes: existing booking title, owner, and time
- User can modify their selection after seeing conflict

### FR-5: Cancel Booking
Users can cancel any booking that hasn't started yet.

**Cancellation Rules:**
- Bookings that have already started cannot be cancelled
- Bookings in the past cannot be cancelled
- Cancellation is immediate (no confirmation dialog required)
- Cancelled bookings are removed from the calendar

**Validation Criteria:**
- Cancel button only appears on future bookings
- Cancelled booking disappears from view immediately
- Time slot becomes available for new bookings

### FR-6: Booking Details
Clicking a booking on the calendar shows its details in a side panel or modal.

**Details Displayed:**
- Resource name
- Title
- Date
- Start time and end time
- Duration (calculated)
- Created timestamp
- Cancel button (if applicable per FR-5)

**Validation Criteria:**
- Details panel opens when any booking is clicked
- All fields display correctly
- Duration is shown in hours and minutes (e.g., "1h 30m")

---

## Non-Functional Requirements

### Performance
- Initial page load < 2 seconds
- Booking creation < 500ms
- Calendar navigation < 200ms
- Support up to 100 bookings per resource per week

### Reliability & Scalability
- Data persists across page refreshes
- Graceful handling of storage errors
- Single-user usage (no concurrency concerns)

### Observability
- Console logging for all booking operations
- Error states displayed in UI

### Compliance & Privacy
- No PII collected beyond booking titles
- No external data transmission

---

## Security

### Authentication
None required - single-user application for testing purposes.

### Authorization
All users have full access to all operations.

### Data Handling
- **PII Classification:** None
- **Data Retention:** Until manually cleared
- **Data Deletion:** Browser storage can be cleared manually

### Encryption & Key Management
- **At Rest:** Browser localStorage (unencrypted, acceptable for this use case)
- **In Transit:** N/A (no server communication)

### Audit & Logging
- **Coverage:** All create/cancel operations logged to console
- **Retention:** Session only

---

## Data Model

### Entities

```typescript
interface Resource {
  id: string;           // e.g., "room-a", "room-b", "projector"
  name: string;         // e.g., "Conference Room A"
  capacity: number;     // e.g., 8
}

interface Booking {
  id: string;           // UUID
  resourceId: string;   // FK to Resource
  title: string;        // User-provided title
  date: string;         // ISO date: "2025-01-15"
  startTime: string;    // 24h format: "09:00"
  endTime: string;      // 24h format: "10:30"
  createdAt: string;    // ISO timestamp
}
```

### Relationships
- Resource has many Bookings
- Booking belongs to one Resource

### Validation Rules
- `title`: 1-50 characters, trimmed, non-empty
- `date`: Valid ISO date, not in the past
- `startTime`: Must be between "08:00" and "17:30" (last slot that allows 30-min booking)
- `endTime`: Must be after startTime, between "08:30" and "18:00"
- Duration: minimum 30 minutes, maximum 4 hours
- Times must be on 30-minute boundaries

---

## Interfaces & Contracts

### APIs
No backend API - all data stored in localStorage.

### Storage Schema

```javascript
// localStorage key: "bookings"
// Value: JSON array of Booking objects
[
  {
    "id": "uuid-1234",
    "resourceId": "room-a",
    "title": "Team Standup",
    "date": "2025-01-15",
    "startTime": "09:00",
    "endTime": "09:30",
    "createdAt": "2025-01-14T10:30:00Z"
  }
]
```

### Events
None - synchronous localStorage operations.

### External Integrations
None.

---

## Deterministic Tests

```json
{
  "id": "DT-001",
  "description": "Adjacent bookings (9:00-10:00 and 10:00-11:00) are NOT conflicts",
  "input": {
    "existing": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "09:00", "endTime": "10:00"},
    "new": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "10:00", "endTime": "11:00"}
  },
  "expected": "booking_created"
}
```

```json
{
  "id": "DT-002", 
  "description": "Overlapping bookings (9:00-10:00 and 9:30-10:30) ARE conflicts",
  "input": {
    "existing": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "09:00", "endTime": "10:00"},
    "new": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "09:30", "endTime": "10:30"}
  },
  "expected": "conflict_error"
}
```

```json
{
  "id": "DT-003",
  "description": "Same time on different resources is NOT a conflict",
  "input": {
    "existing": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "09:00", "endTime": "10:00"},
    "new": {"resourceId": "room-b", "date": "2025-01-15", "startTime": "09:00", "endTime": "10:00"}
  },
  "expected": "booking_created"
}
```

```json
{
  "id": "DT-004",
  "description": "Booking spanning exactly 4 hours is valid",
  "input": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "09:00", "endTime": "13:00"},
  "expected": "booking_created"
}
```

```json
{
  "id": "DT-005",
  "description": "Booking spanning 4 hours 30 minutes is INVALID",
  "input": {"resourceId": "room-a", "date": "2025-01-15", "startTime": "09:00", "endTime": "13:30"},
  "expected": "validation_error_max_duration"
}
```

---

## Acceptance Tests

### User Stories

**Story 1:** As a team member, I want to book a meeting room for a specific time, so that I can ensure the space is available for my meeting.

**Story 2:** As a team member, I want to see all bookings for the week, so that I can find an open time slot.

**Story 3:** As a team member, I want to cancel a booking I no longer need, so that others can use that time slot.

### Acceptance Criteria

- [ ] Given I'm on the app, When the page loads, Then I see all 3 resources listed
- [ ] Given I'm viewing the calendar, When I navigate to next week, Then the dates update correctly
- [ ] Given a resource has no bookings, When I view its calendar, Then I see all time slots as available
- [ ] Given I'm creating a booking, When I select an end time before the start time, Then I see a validation error
- [ ] Given a booking exists from 9-10am, When I try to book 9:30-10:30am on the same resource, Then I see a conflict error
- [ ] Given a booking exists from 9-10am, When I try to book 10-11am on the same resource, Then the booking succeeds
- [ ] Given a booking starts in 1 hour, When I view its details, Then I see a Cancel button
- [ ] Given a booking started 5 minutes ago, When I view its details, Then I do NOT see a Cancel button
- [ ] Given I cancel a booking, When the calendar refreshes, Then the booking is removed
- [ ] Given it's 3:45pm, When I try to create a booking starting at 3:30pm today, Then I see a "cannot book in past" error

---

## Glossary & Definitions

- **Booking:** A reservation of a resource for a specific time period
- **Conflict:** When two bookings for the same resource have overlapping time periods (start < other.end AND end > other.start)
- **Adjacent:** Bookings where one ends exactly when another starts - these are NOT conflicts
- **Past booking:** A booking where the start time has already passed (compared to current time)
- **Future booking:** A booking where the start time has not yet passed
- **Time boundary:** Times that fall on :00 or :30 minutes

---

## Risks & Open Questions

### Risks
- **R-1:** Time zone handling could cause display issues
  - **Impact:** Medium
  - **Mitigation:** All times treated as local browser time, no TZ conversion

- **R-2:** localStorage has size limits (~5MB)
  - **Impact:** Low  
  - **Mitigation:** Acceptable for testing use case

### Open Questions
None - spec is complete for testing purposes.

---

## AI Testing Notes ⚠️

This spec is intentionally designed to expose common AI code generation weaknesses. When evaluating AI implementations, watch for these **trap areas**:

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

**Status:** 🟢 Complete - Level 3
**Agent Ready:** ✅ Yes
**Required Level:** 3 (EASY)
**Estimated Implementation Time:** 5-10 hours
