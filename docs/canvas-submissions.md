# How submission data is fetched

Answers [#57](../../issues/57) ("Investigate batch Canvas submission fetching").
**Decision: keep the current approach; do not adopt
`/courses/:id/students/submissions`.** The premise the issue was opened on — one
submission request per assignment — is not what the code does, and the batch
endpoint would add requests rather than remove them.

## What the extension does today

`processSingleCourse()` (`content-script.js:302`) asks for a course's
assignments with the submission attached:

```js
assignments = await this.makeAPICall(`/courses/${course.id}/assignments`, {
  'per_page': 100,
  'order_by': 'due_at',
  'include': 'submission'
}, 50);
```

Canvas documents `include[]=submission` on that endpoint as returning "the
current user's current Submission", omitting the key entirely for an assignment
with no submission. `transformAssignmentsForCourse()`
(`content-script.js:359`) reads `grade`, `score` and `workflow_state` off that
object to produce the Notion `Status`, `Grade` and percentage.

No other code path fetches submissions. Nothing in `src/` or `popup.js` calls a
`/submissions` endpoint at all.

## Request-count comparison

For a student in 6 courses with 40 assignments each (one page of assignments per
course):

| | Course list | Assignment lists | Submission lists | Total |
| --- | --- | --- | --- | --- |
| Today | 1 | 6 | 0 (inline) | **7** |
| Per-assignment submissions (the premise) | 1 | 6 | 240 | 247 |
| Batch `students/submissions` | 1 | 6 | 6 | **13** |

The assignment list is not optional under any variant: names, due dates, points,
`html_url`, `submission_types` and descriptions only come from there. So a batch
submissions call is always *additional*, not a replacement — it nearly doubles
the request count of a sync, and each of those requests spends leaky-bucket
units and a round trip against the 700-unit Canvas budget.

The win the issue was reaching for (247 → 13) is real, but `include=submission`
already took it, and took slightly more of it than the batch endpoint would.

## Endpoint semantics, for the record

From the [Canvas submissions
docs](https://canvas.instructure.com/doc/api/submissions.html), so this does not
have to be re-read later:

- "Students may only list their own submissions." Omitting `student_ids[]`
  returns the calling user's, and `student_ids[]=self` is the documented way to
  name yourself explicitly.
- The response is a flat array of submissions keyed by `assignment_id`, or, with
  `grouped`, an array of per-student objects. Either shape needs mapping back
  onto assignments by ID, which `include=submission` gives for free.
- It paginates independently of the assignment list, so a course with more than
  a page of submissions costs extra requests that today's single list does not.

Both Canvas auth modes the extension supports (session cookie on a Canvas tab,
or a bearer token) act as the same user, so the permission behaviour above
applies to both. That was not verified against a live Canvas instance — see
below.

## A second reason to keep the include

Assignments are cached for 5 minutes with their submissions inside the same
entry (`canvas:course:<id>:assignments`). Splitting submissions into their own
call splits that cache: submission freshness would decouple from assignment
freshness, and the cache layer would need a second key with its own TTL and
invalidation. That is real complexity bought for nothing at the current request
volume.

## What would change the answer

- **Richer submission detail.** `include[]` on the batch endpoint reaches
  `submission_history`, `rubric_assessment` and submission comments, which the
  inline include does not carry. If the backlog items for instructor feedback or
  rubric criteria ever land, per-course batch fetching is the right shape for
  them — one call per course instead of one per assignment. Note that
  `late`, `missing` and `excused` are already on the inline submission object.
- **Refreshing statuses without re-listing assignments.** If a sync ever wants
  to update only submission state for assignments it already has cached, a
  single `students/submissions` call per course would do that without paying for
  the assignment list. No current code path wants this.

## What still needs a human

The measured comparison the issue asked for was not possible from CI: it needs a
real Canvas account, and the numbers above are derived from the request shapes
rather than from a stopwatch. If the owner wants the measurement anyway, the
thing to confirm is the `X-Request-Cost` header on
`/courses/:id/assignments?include=submission` versus an assignments call plus a
`students/submissions` call — the argument here assumes the include costs less
than a whole extra request, which is near-certain but unmeasured.

`test/content-script-submissions.test.js` locks in the properties this decision
rests on: the include is requested, a sync costs one request per course page
regardless of assignment count, and no separate submissions request is ever
issued.
