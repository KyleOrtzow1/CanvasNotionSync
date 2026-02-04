# Canvas API Documentation

This document provides comprehensive documentation of the Canvas LMS REST API features relevant to the Canvas-Notion Assignment Sync extension and future feature development.

## Table of Contents

- [Getting Started](#getting-started)
- [Authentication & Authorization](#authentication--authorization)
- [Rate Limiting & Pagination](#rate-limiting--pagination)
- [Core APIs](#core-apis)
  - [Courses API](#courses-api)
  - [Assignments API](#assignments-api)
  - [Submissions API](#submissions-api)
  - [Calendar Events API](#calendar-events-api)
  - [Planner & Todos API](#planner--todos-api)
  - [Announcements API](#announcements-api)
  - [Modules API](#modules-api)
  - [Discussion Topics API](#discussion-topics-api)
  - [Quizzes API](#quizzes-api)
  - [Rubrics API](#rubrics-api)
  - [Users API](#users-api)
  - [Enrollments API](#enrollments-api)
  - [Groups API](#groups-api)
- [Best Practices](#best-practices)
- [Future Feature Ideas](#future-feature-ideas)

---

## Getting Started

### Base URL Structure
```
https://{canvas-instance}.instructure.com/api/v1/
```

### API Versioning
The Canvas API uses versioning in the URL path. The current stable version is `v1`.

### Official Documentation
- **Main API Documentation**: https://canvas.instructure.com/doc/api/
- **Developer Portal**: https://developerdocs.instructure.com/

---

## Authentication & Authorization

### Access Tokens
Canvas uses OAuth2 (RFC-6749) for API authentication. Access tokens are password-equivalent and must be kept secure.

**Token Generation:**
- Users can generate personal access tokens in Canvas Account Settings
- Tokens issued after October 2015 expire after 1 hour
- Applications must use refresh tokens to generate new access tokens

**Token Usage:**
```javascript
// Recommended: Use Authorization header
headers: {
  'Authorization': 'Bearer YOUR_ACCESS_TOKEN'
}

// Alternative: Query parameter (not recommended)
?access_token=YOUR_ACCESS_TOKEN
```

### OAuth2 Scopes
Scopes control what API endpoints an access token can access. Root account administrators can manage scope restrictions at the developer key level.

**Common Scopes:**
- `url:GET|/api/v1/courses/:course_id/assignments` - Read assignments
- `url:POST|/api/v1/courses/:course_id/assignments` - Create assignments
- `/auth/userinfo` - Access user identity information

**Documentation:** https://www.canvas.instructure.com/doc/api/file.oauth.html

### Developer Keys
Developer keys are OAuth2 client ID/secret pairs that allow third-party applications to request Canvas API access via OAuth2 flow.

**Documentation:** https://www.canvas.instructure.com/doc/api/file.developer_keys.html

---

## Rate Limiting & Pagination

### Rate Limiting

Canvas uses a **"leaky bucket" algorithm** for rate limiting based on the API token (not account, instance, or user).

**Key Metrics:**
- **Request Cost**: CPU time (seconds) + Database time (seconds)
- **Bucket Size (High Water Mark)**: 700 units
- **Leak Rate**: 10 units/second (default)
- **Recovery Time**: Full bucket empties in ~60 seconds

**Rate Limit Headers:**
```
X-Request-Cost: 2.35          # Cost of this request
X-Rate-Limit-Remaining: 650   # Remaining quota
```

**429 Response:**
When throttled, you'll receive a `403 Forbidden (Rate Limit Exceeded)` response. Your application should retry the request later with exponential backoff.

**Best Practices:**
- Monitor `X-Request-Cost` and `X-Rate-Limit-Remaining` headers
- Sequential processing prevents rate limiting (bucket leaks faster than it fills)
- Failed requests still count against quota but are "cheap" to process
- Contact Customer Success Manager for high-volume usage optimization

**Documentation:** https://canvas.instructure.com/doc/api/file.throttling.html

### Pagination

Most list endpoints return paginated results.

**Default Behavior:**
- 10 items per page by default
- Maximum ~100 items per page (varies by endpoint)

**Parameters:**
```
?per_page=100          # Request 100 items per page
```

**Link Headers:**
Canvas returns `Link` headers with URLs for navigation:
```
Link: <https://example.com/api/v1/courses?page=2>; rel="next",
      <https://example.com/api/v1/courses?page=1>; rel="prev",
      <https://example.com/api/v1/courses?page=1>; rel="first",
      <https://example.com/api/v1/courses?page=5>; rel="last"
```

**Best Practice:** Always use Link headers as opaque URLs rather than constructing pagination URLs manually.

**Documentation:** https://canvas.instructure.com/doc/api/file.pagination.html

---

## Core APIs

### Courses API

Retrieve and manage course information.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses` | List your courses |
| GET | `/api/v1/courses/:id` | Get single course details |
| GET | `/api/v1/courses/:course_id/users` | List users in course |
| GET | `/api/v1/courses/:course_id/students` | List students in course |

**Include Parameters:**
- `term` - Include course term
- `total_scores` - Include total grade
- `current_grading_period_scores` - Include grading period scores
- `course_image` - Include course image URL
- `concluded` - Include concluded courses

**Example:**
```javascript
GET /api/v1/courses?include[]=term&include[]=total_scores
```

**Documentation:** https://documentation.instructure.com/doc/api/courses.html

---

### Assignments API

Create, read, update, and delete assignments.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/assignments` | List assignments |
| GET | `/api/v1/courses/:course_id/assignments/:id` | Get single assignment |
| POST | `/api/v1/courses/:course_id/assignments` | Create assignment |
| PUT | `/api/v1/courses/:course_id/assignments/:id` | Update assignment |
| DELETE | `/api/v1/courses/:course_id/assignments/:id` | Delete assignment |
| PUT | `/api/v1/courses/:course_id/assignments/:id/override` | Update due dates/availability |

**Assignment Object Fields:**
```javascript
{
  id: number,                          // Canvas assignment ID
  name: string,                        // Assignment name
  description: string,                 // HTML description
  due_at: string,                      // ISO 8601 due date
  lock_at: string,                     // When assignment locks
  unlock_at: string,                   // When assignment becomes available
  points_possible: number,             // Maximum points
  grading_type: string,                // 'pass_fail', 'percent', 'letter_grade', 'gpa_scale', 'points'
  submission_types: [string],          // ['online_text_entry', 'online_url', 'online_upload', etc.]
  has_submitted_submissions: boolean,  // Whether any submissions exist
  published: boolean,                  // Whether assignment is published
  course_id: number,                   // Parent course ID
  html_url: string,                    // Web URL to assignment
  locked_for_user: boolean,           // Whether locked for current user
  lock_explanation: string            // Why assignment is locked
}
```

**Include Parameters:**
- `submission` - Include user's submission data
- `assignment_visibility` - Include assignment visibility info
- `overrides` - Include assignment overrides
- `observed_users` - Include observed users' submissions
- `all_dates` - Include all date information
- `score_statistics` - Include score statistics

**Search/Filter Parameters:**
- `search_term` - Partial assignment name match
- `order_by` - Sort by position, name, due_at
- `bucket` - Filter: past, overdue, undated, ungraded, unsubmitted, upcoming, future

**Example - Current Extension Usage:**
```javascript
GET /api/v1/courses/:course_id/assignments?include[]=submission&include[]=score_statistics
```

**Bulk Update Due Dates:**
```javascript
PUT /api/v1/courses/:course_id/assignments/bulk_update
```

**Documentation:** https://canvas.colorado.edu/doc/api/assignments.html

---

### Submissions API

Access and update student assignment submissions and grades.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/students/submissions` | List all submissions for multiple assignments |
| GET | `/api/v1/courses/:course_id/assignments/:assignment_id/submissions` | List submissions for one assignment |
| GET | `/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id` | Get single submission |
| PUT | `/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id` | Grade/comment on submission |
| POST | `/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id/comments/files` | Upload file for comment |

**Submission Object Fields:**
```javascript
{
  id: number,                          // Submission ID
  assignment_id: number,               // Assignment ID
  user_id: number,                     // Student user ID
  submitted_at: string,                // ISO 8601 submission time
  graded_at: string,                   // When graded
  grade: string,                       // Grade assigned
  score: number,                       // Numeric score
  attempt: number,                     // Submission attempt number
  workflow_state: string,              // 'submitted', 'unsubmitted', 'graded', 'pending_review'
  late: boolean,                       // Whether submission was late
  missing: boolean,                    // Whether submission is missing
  late_policy_status: string,          // null, 'late', 'missing', 'extended'
  excused: boolean,                    // Whether submission is excused
  submission_type: string,             // 'online_text_entry', 'online_url', 'online_upload', etc.
  url: string,                         // URL submission (if applicable)
  body: string,                        // Text submission content
  preview_url: string                  // Preview URL for submission
}
```

**Include Parameters:**
- `submission_history` - Include all submission versions
- `submission_comments` - Include comments
- `rubric_assessment` - Include rubric assessment
- `assignment` - Include assignment details
- `visibility` - Include assignment visibility
- `course` - Include course info
- `user` - Include user info

**Grading/Updating Submissions:**
```javascript
PUT /api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id

Body:
{
  submission: {
    posted_grade: "95"  // or "A", "pass", depending on grading_type
  },
  comment: {
    text_comment: "Great work!"
  }
}
```

**Bulk Grade Updates:**
```javascript
POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions/update_grades
```

**Documentation:** https://www.canvas.instructure.com/doc/api/submissions.html

---

### Calendar Events API

Access calendar events and assignment due dates.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/calendar_events` | List calendar events |
| GET | `/api/v1/calendar_events/:id` | Get single calendar event |
| POST | `/api/v1/calendar_events` | Create calendar event |
| PUT | `/api/v1/calendar_events/:id` | Update calendar event |
| DELETE | `/api/v1/calendar_events/:id` | Delete calendar event |

**Calendar Event Object:**
```javascript
{
  id: number,                          // Event ID
  title: string,                       // Event title
  start_at: string,                    // ISO 8601 start time
  end_at: string,                      // ISO 8601 end time
  description: string,                 // HTML description
  location_name: string,               // Location
  location_address: string,            // Address
  context_code: string,                // 'course_123', 'user_456', etc.
  workflow_state: string,              // 'active', 'deleted'
  hidden: boolean,                     // Whether hidden from calendar
  url: string,                         // Event URL
  html_url: string,                    // Web URL
  all_day: boolean,                    // All-day event flag
  all_day_date: string,                // Date for all-day events
  assignment: {...}                    // Assignment object (if applicable)
}
```

**Query Parameters:**
- `context_codes[]` - Filter by context (course_123, user_456, etc.)
- `start_date` - Only events since this date (YYYY-MM-DD or ISO 8601)
- `end_date` - Only events before this date (YYYY-MM-DD or ISO 8601)
- `type` - Filter by event type: 'event' or 'assignment'
- `all_events` - Include past events (default: false)
- `undated` - Include undated events

**Assignment Due Dates:**
Assignments appear in calendar events with a synthetic ID and include the `due_at` timestamp in both `start_at` and `end_at` fields. Assignment override information helps determine which students/sections the event applies to.

**Example:**
```javascript
GET /api/v1/calendar_events?type=assignment&context_codes[]=course_123&start_date=2026-01-01&end_date=2026-12-31
```

**Documentation:** https://www.canvas.instructure.com/doc/api/calendar_events.html

---

### Planner & Todos API

Access student planner items and create planner notes.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/planner/items` | List planner items |
| GET | `/api/v1/users/:user_id/planner_notes` | List planner notes |
| POST | `/api/v1/planner_notes` | Create planner note |
| GET | `/api/v1/planner_notes/:id` | Get planner note |
| PUT | `/api/v1/planner_notes/:id` | Update planner note |
| DELETE | `/api/v1/planner_notes/:id` | Delete planner note |

**Planner Item Object:**
```javascript
{
  course_id: number,                   // Course ID (if applicable)
  plannable_id: number,                // ID of underlying object
  plannable_type: string,              // 'assignment', 'quiz', 'discussion_topic', 'wiki_page', 'planner_note'
  plannable: {...},                    // The actual object (assignment, quiz, etc.)
  html_url: string,                    // Web URL to item
  plannable_date: string,              // ISO 8601 due/scheduled date
  submissions: {...},                  // Submission info (if applicable)
  context_type: string,                // 'Course', 'User'
  context_name: string                 // Course/context name
}
```

**Query Parameters:**
- `start_date` - Start date for planner items (ISO 8601)
- `end_date` - End date for planner items (ISO 8601)
- `context_codes[]` - Filter by context
- `filter` - Filter: 'new_activity' (ungraded submissions)

**Planner Overrides:**
Planner overrides control visibility and completion status of planner items.

```javascript
POST /api/v1/planner/overrides
{
  plannable_type: 'assignment',
  plannable_id: 123,
  marked_complete: true
}
```

**Documentation:** https://canvas.instructure.com/doc/api/planner.html

---

### Announcements API

Access course announcements.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/announcements` | List announcements across courses |
| GET | `/api/v1/courses/:course_id/discussion_topics?only_announcements=true` | List course announcements |

**Announcement Object:**
Announcements are discussion topics with special attributes.

```javascript
{
  id: number,                          // Announcement ID
  title: string,                       // Announcement title
  message: string,                     // HTML content
  posted_at: string,                   // ISO 8601 post time
  delayed_post_at: string,             // Scheduled post time
  author: {...},                       // User who created announcement
  read_state: string,                  // 'read', 'unread'
  subscribed: boolean,                 // Whether user is subscribed
  html_url: string,                    // Web URL
  context_code: string                 // Course context code
}
```

**Query Parameters:**
- `context_codes[]` - Filter by courses (course_123, course_456)
- `start_date` - Only announcements since date
- `end_date` - Only announcements before date
- `active_only` - Only active announcements (default: false)
- `latest_only` - Only latest announcement per context (default: false)

**Documentation:** Available through Discussion Topics API

---

### Modules API

Access course modules and module items.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/modules` | List modules |
| GET | `/api/v1/courses/:course_id/modules/:id` | Get single module |
| GET | `/api/v1/courses/:course_id/modules/:module_id/items` | List module items |
| GET | `/api/v1/courses/:course_id/modules/:module_id/items/:id` | Get single module item |
| POST | `/api/v1/courses/:course_id/modules` | Create module |
| PUT | `/api/v1/courses/:course_id/modules/:id` | Update module |
| DELETE | `/api/v1/courses/:course_id/modules/:id` | Delete module |

**Module Object:**
```javascript
{
  id: number,                          // Module ID
  name: string,                        // Module name
  position: number,                    // Module position in course
  unlock_at: string,                   // When module unlocks
  require_sequential_progress: boolean,// Must complete items in order
  prerequisite_module_ids: [number],   // IDs of prerequisite modules
  state: string,                       // 'locked', 'unlocked', 'started', 'completed'
  completed_at: string,                // When user completed module
  items_count: number,                 // Number of items in module
  items_url: string                    // API URL for module items
}
```

**Module Item Object:**
```javascript
{
  id: number,                          // Item ID
  module_id: number,                   // Parent module ID
  position: number,                    // Item position in module
  title: string,                       // Item title
  indent: number,                      // Indentation level (0-10)
  type: string,                        // 'File', 'Page', 'Discussion', 'Assignment', 'Quiz', 'SubHeader', 'ExternalUrl', 'ExternalTool'
  content_id: number,                  // ID of underlying content
  html_url: string,                    // Web URL
  url: string,                         // API URL
  completion_requirement: {...},       // Completion criteria
  published: boolean                   // Whether item is published
}
```

**Include Parameters:**
- `items` - Include module items
- `content_details` - Include item content details

**Use Cases for Extension:**
- Track module progress
- Display module structure in Notion
- Sync module due dates
- Show locked/unlocked status

**Documentation:** https://www.canvas.instructure.com/doc/api/modules.html

---

### Discussion Topics API

Access and manage discussion topics (forums).

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/discussion_topics` | List discussion topics |
| GET | `/api/v1/courses/:course_id/discussion_topics/:id` | Get discussion topic |
| POST | `/api/v1/courses/:course_id/discussion_topics` | Create discussion |
| PUT | `/api/v1/courses/:course_id/discussion_topics/:id` | Update discussion |
| DELETE | `/api/v1/courses/:course_id/discussion_topics/:id` | Delete discussion |
| GET | `/api/v1/courses/:course_id/discussion_topics/:topic_id/entries` | Get discussion entries |
| POST | `/api/v1/courses/:course_id/discussion_topics/:topic_id/entries` | Post reply |

**Discussion Topic Object:**
```javascript
{
  id: number,                          // Topic ID
  title: string,                       // Discussion title
  message: string,                     // HTML content
  posted_at: string,                   // ISO 8601 post time
  last_reply_at: string,               // Last reply timestamp
  require_initial_post: boolean,       // Must post before seeing replies
  discussion_subentry_count: number,   // Number of replies
  read_state: string,                  // 'read', 'unread'
  unread_count: number,                // Unread replies count
  assignment_id: number,               // Assignment ID (if graded)
  assignment: {...},                   // Assignment object
  locked: boolean,                     // Whether discussion is locked
  pinned: boolean,                     // Whether pinned to top
  html_url: string,                    // Web URL
  published: boolean,                  // Whether published
  discussion_type: string              // 'side_comment', 'threaded'
}
```

**Query Parameters:**
- `only_announcements` - Return only announcements
- `search_term` - Search discussion titles and descriptions
- `order_by` - Sort by 'position', 'recent_activity', 'title'

**Use Cases for Extension:**
- Sync graded discussions as assignments
- Track unread discussion counts
- Show discussion due dates in Notion

**Documentation:** https://canvas.instructure.com/doc/api/discussion_topics.html

---

### Quizzes API

Access quiz information and submissions.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/quizzes` | List quizzes |
| GET | `/api/v1/courses/:course_id/quizzes/:id` | Get single quiz |
| GET | `/api/v1/courses/:course_id/quizzes/:quiz_id/submissions` | List quiz submissions |
| GET | `/api/v1/courses/:course_id/quizzes/:quiz_id/questions` | List quiz questions |

**Quiz Object:**
```javascript
{
  id: number,                          // Quiz ID
  title: string,                       // Quiz title
  description: string,                 // HTML description
  quiz_type: string,                   // 'practice_quiz', 'assignment', 'graded_survey', 'survey'
  assignment_id: number,               // Assignment ID (if graded)
  time_limit: number,                  // Time limit in minutes
  shuffle_answers: boolean,            // Randomize answer order
  show_correct_answers: boolean,       // Show correct answers after
  show_correct_answers_at: string,     // When to show correct answers
  hide_correct_answers_at: string,     // When to hide correct answers
  one_time_results: boolean,           // Can only see results once
  points_possible: number,             // Maximum points
  due_at: string,                      // ISO 8601 due date
  lock_at: string,                     // When quiz locks
  unlock_at: string,                   // When quiz unlocks
  published: boolean,                  // Whether published
  locked_for_user: boolean,            // Whether locked for user
  html_url: string,                    // Web URL
  question_count: number,              // Number of questions
  allowed_attempts: number             // -1 for unlimited
}
```

**New Quizzes API:**
Canvas has a newer "New Quizzes" system with a separate API.

**Documentation:**
- Classic Quizzes: https://canvas.instructure.com/doc/api/quizzes.html
- New Quizzes: https://canvas.instructure.com/doc/api/new_quizzes.html

---

### Rubrics API

Access rubric information for assignments.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/rubrics` | List rubrics |
| GET | `/api/v1/courses/:course_id/rubrics/:id` | Get single rubric |

**Rubric Object:**
```javascript
{
  id: number,                          // Rubric ID
  title: string,                       // Rubric title
  context_id: number,                  // Course ID
  context_type: string,                // 'Course'
  points_possible: number,             // Maximum points
  free_form_criterion_comments: boolean,// Allow free-form comments
  read_only: boolean,                  // Whether read-only
  criteria: [                          // Array of criteria
    {
      id: string,                      // Criterion ID
      description: string,             // Criterion description
      long_description: string,        // Detailed description
      points: number,                  // Criterion points
      criterion_use_range: boolean,    // Use point range
      ratings: [                       // Rating levels
        {
          id: string,                  // Rating ID
          description: string,         // Rating description
          long_description: string,    // Detailed description
          points: number               // Points for this rating
        }
      ]
    }
  ]
}
```

**Use Cases for Extension:**
- Display rubric criteria in Notion
- Show grading standards
- Track rubric-based assessment

**Documentation:** https://canvas.instructure.com/doc/api/rubrics.html

---

### Users API

Access user profile information and settings.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/:id` | Get user profile |
| GET | `/api/v1/users/self` | Get current user profile |
| GET | `/api/v1/users/:user_id/profile` | Get user profile details |
| GET | `/api/v1/users/:user_id/avatars` | Get user avatar options |
| GET | `/api/v1/courses/:course_id/users` | List users in course |
| GET | `/api/v1/courses/:course_id/search_users` | Search users in course |

**User Object:**
```javascript
{
  id: number,                          // User ID
  name: string,                        // Full name
  sortable_name: string,               // Last, First format
  short_name: string,                  // Preferred name
  login_id: string,                    // Login username
  avatar_url: string,                  // Profile picture URL
  email: string,                       // Email address (if permitted)
  locale: string,                      // User's locale
  bio: string,                         // Profile bio
  calendar: {                          // Calendar feed URL
    ics: string
  },
  lti_user_id: string                  // LTI user ID
}
```

**Include Parameters:**
- `avatar_url` - Include avatar URL
- `email` - Include email (if permitted)
- `bio` - Include profile bio
- `enrollments` - Include course enrollments

**Use Cases for Extension:**
- Display student information
- Access calendar feeds
- Get user preferences

**Documentation:** https://mitt.uib.no/doc/api/users.html

---

### Enrollments API

Access and manage course enrollments.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/courses/:course_id/enrollments` | List course enrollments |
| GET | `/api/v1/sections/:section_id/enrollments` | List section enrollments |
| GET | `/api/v1/users/:user_id/enrollments` | List user enrollments |
| POST | `/api/v1/courses/:course_id/enrollments` | Enroll user (admin only) |
| DELETE | `/api/v1/courses/:course_id/enrollments/:id` | Conclude/delete enrollment |

**Enrollment Object:**
```javascript
{
  id: number,                          // Enrollment ID
  user_id: number,                     // User ID
  course_id: number,                   // Course ID
  course_section_id: number,           // Section ID
  type: string,                        // 'StudentEnrollment', 'TeacherEnrollment', 'TaEnrollment', 'DesignerEnrollment', 'ObserverEnrollment'
  enrollment_state: string,            // 'active', 'invited', 'inactive', 'completed'
  role: string,                        // Role name
  role_id: number,                     // Role ID
  created_at: string,                  // ISO 8601 enrollment date
  start_at: string,                    // Enrollment start date
  end_at: string,                      // Enrollment end date
  last_activity_at: string,            // Last activity timestamp
  total_activity_time: number,         // Total time spent (seconds)
  grades: {                            // Grade information
    html_url: string,                  // Grades page URL
    current_score: number,             // Current percentage
    current_grade: string,             // Current letter grade
    final_score: number,               // Final percentage
    final_grade: string                // Final letter grade
  },
  user: {...},                         // User object (with include)
  observed_user: {...}                 // Observed user (for observers)
}
```

**Query Parameters:**
- `type[]` - Filter by enrollment type
- `state[]` - Filter by enrollment state
- `user_id` - Filter by user (course/section queries only)

**Include Parameters:**
- `avatar_url` - Include user avatar
- `group_ids` - Include user's group IDs
- `locked` - Include lock status
- `observed_users` - Include observed users (observers)
- `current_points` - Include current points

**Authorization:**
Only root-level admin users can return other users' enrollments. Users can return their own enrollments.

**Use Cases for Extension:**
- Display course roster
- Show grade information
- Track enrollment status

**Documentation:** https://www.canvas.instructure.com/doc/api/enrollments.html

---

### Groups API

Access group information and membership.

**Key Endpoints:**

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/users/self/groups` | List current user's groups |
| GET | `/api/v1/courses/:course_id/groups` | List course groups |
| GET | `/api/v1/groups/:group_id` | Get single group |
| GET | `/api/v1/groups/:group_id/users` | List group members |

**Group Object:**
```javascript
{
  id: number,                          // Group ID
  name: string,                        // Group name
  description: string,                 // Group description
  is_public: boolean,                  // Whether group is public
  followed_by_user: boolean,           // Whether user follows group
  members_count: number,               // Number of members
  avatar_url: string,                  // Group avatar URL
  context_type: string,                // 'Course', 'Account'
  course_id: number,                   // Course ID (if applicable)
  role: string,                        // User's role in group
  group_category_id: number,           // Category ID
  storage_quota_mb: number,            // Storage limit
  permissions: {...},                  // Permission flags
  concluded: boolean                   // Whether group is concluded
}
```

**Use Cases for Extension:**
- Display group assignments
- Show group membership
- Track group collaboration

**Documentation:** https://canvas.instructure.com/doc/api/groups.html

---

## Best Practices

### 1. Authentication
- Use the `Authorization` header for tokens (not query parameters)
- Store tokens securely with encryption (already implemented in extension)
- Never log or expose tokens in client-side code
- Request minimal scopes necessary for functionality

### 2. Rate Limiting
- Monitor `X-Request-Cost` and `X-Rate-Limit-Remaining` headers
- Implement exponential backoff for 429 responses (already implemented)
- Use batch endpoints when available
- Sequential processing avoids rate limiting

### 3. Pagination
- Always use Link headers for pagination (don't construct URLs manually)
- Request reasonable page sizes (50-100 items)
- Handle empty result sets gracefully
- Cache results when appropriate

### 4. Performance
- Use `include[]` parameters to reduce API calls
- Batch requests when possible
- Implement caching for rarely-changing data (courses, users)
- Use webhooks for real-time updates (not yet implemented)

### 5. Error Handling
- Handle network errors gracefully
- Provide meaningful error messages to users
- Retry failed requests with exponential backoff
- Log errors for debugging (without exposing sensitive data)

### 6. Data Integrity
- Use Canvas IDs for deduplication (already implemented)
- Validate data before syncing to Notion
- Handle edge cases (missing due dates, null values)
- Test with various assignment types

---

## Future Feature Ideas

Based on the Canvas API capabilities, here are potential features to add to the extension:

### High Priority

1. **Calendar Integration**
   - Sync all calendar events (not just assignments)
   - Include course events, personal events
   - Show event locations and times in Notion

2. **Module Tracking**
   - Display course module structure in Notion
   - Track module completion progress
   - Show locked/unlocked modules
   - Sync module requirements

3. **Quiz Integration**
   - Sync quiz due dates as assignments
   - Display quiz attempt information
   - Show quiz scores and feedback

4. **Discussion Topics**
   - Sync graded discussions as assignments
   - Track unread discussion counts
   - Show discussion participation requirements

5. **Submission Status Details**
   - Show detailed submission information (late, missing, excused)
   - Display submission comments
   - Link to submission previews

### Medium Priority

6. **Planner/Todo Integration**
   - Sync Canvas planner items to Notion
   - Create two-way sync (Notion → Canvas planner notes)
   - Track planner item completion

7. **Announcements Feed**
   - Sync course announcements to Notion
   - Filter by date range
   - Show unread status

8. **Grade Analytics**
   - Display grade distributions (score statistics)
   - Show current course grade
   - Calculate grade impact of upcoming assignments

9. **Rubric Display**
   - Show assignment rubrics in Notion
   - Display rubric criteria and ratings
   - Link to rubric assessments

10. **Multi-Course Dashboard**
    - Create aggregated view of all courses
    - Filter assignments by course
    - Show course progress overview

### Lower Priority

11. **Enrollment Information**
    - Display enrolled students (for instructors)
    - Show course enrollment status
    - Track enrollment dates

12. **Group Assignments**
    - Display group information for group assignments
    - Show group member assignments
    - Track group collaboration

13. **File Management**
    - Link to assignment files in Notion
    - Track file uploads/downloads
    - Show file submission status

14. **Course Settings Sync**
    - Display course start/end dates
    - Show course access restrictions
    - Track course publication status

15. **Advanced Filtering**
    - Filter by assignment bucket (overdue, upcoming, etc.)
    - Filter by grading status
    - Custom date range filters

### Technical Improvements

16. **Webhook Integration**
    - Real-time updates via Canvas Live Events
    - Reduce polling frequency
    - Instant sync when assignments change

17. **Batch Operations**
    - Bulk sync multiple courses
    - Parallel processing for faster sync
    - Progress indicators for large syncs

18. **Offline Support**
    - Cache assignment data locally
    - Queue sync operations when offline
    - Conflict resolution for offline changes

19. **Enhanced Error Handling**
    - Better error messages for API failures
    - Retry logic for transient errors
    - User notifications for sync issues

20. **Testing Suite**
    - Unit tests for API integration
    - Mock Canvas API for testing
    - Automated testing pipeline

---

## Additional Resources

### Official Documentation
- **Canvas LMS REST API**: https://canvas.instructure.com/doc/api/
- **Instructure Developer Portal**: https://developerdocs.instructure.com/
- **Canvas API Policy**: https://www.instructure.com/policies/canvas-api-policy

### Community Resources
- **Instructure Community - Developers Group**: https://community.canvaslms.com/t5/Developers-Group/ct-p/developers
- **Canvas LMS GitHub**: https://github.com/instructure/canvas-lms
- **CanvasAPI Python Library**: https://canvasapi.readthedocs.io/

### API Testing Tools
- **Postman**: Test Canvas API endpoints
- **Canvas API Explorer**: Built into Canvas at `/doc/api/live`
- **Browser DevTools**: Inspect Canvas API calls in Network tab

---

## Changelog

### Version 1.0 (2026-02-01)
- Initial documentation created
- Comprehensive API endpoint coverage
- Feature ideas for future development
- Best practices and guidelines

---

*This documentation is maintained as part of the Canvas-Notion Assignment Sync extension project. For questions or contributions, please refer to the project README.*
