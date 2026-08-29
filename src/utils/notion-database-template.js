// The columns assignment-syncer.js writes to. The "Set Up Database" button in
// the popup fits a database the user made in Notion with exactly these, so no
// manual column setup is needed.

export const ASSIGNMENT_DATABASE_PROPERTIES = {
  'Checkbox': { checkbox: {} },
  'Course': { select: {} },
  'Assignment Name': { title: {} },
  'Status': {
    select: {
      options: [
        { name: 'Not Started', color: 'default' },
        { name: 'In Progress', color: 'blue' },
        { name: 'Submitted', color: 'yellow' },
        { name: 'Pending Review', color: 'orange' },
        { name: 'Late', color: 'red' },
        { name: 'Graded', color: 'green' }
      ]
    }
  },
  'Due Date': { date: {} },
  'Link to Resources': { url: {} },
  'Points': { number: { format: 'number' } },
  'Notes': { rich_text: {} },
  'Description': { rich_text: {} },
  'Canvas ID': { rich_text: {} },
  'Grade': { number: { format: 'number' } }
};

// Left-to-right column order for the default table view. A new database's view
// starts with no explicit configuration, so Notion falls back to its own
// ordering — these have to be set on the view for the order to stick.
export const ASSIGNMENT_DATABASE_COLUMN_ORDER = [
  'Checkbox',
  'Course',
  'Assignment Name',
  'Status',
  'Due Date',
  'Link to Resources',
  'Points',
  'Notes',
  'Description',
  'Canvas ID'
];

// Synced, but kept off the default view to match the column layout above.
// Unhide it in Notion any time — sync writes to it either way.
export const ASSIGNMENT_DATABASE_HIDDEN_COLUMNS = ['Grade'];

// Default view sort applied to a freshly created database: unchecked items
// first, then soonest due, then alphabetical as a final tiebreak. Deliberately
// excludes anything workspace- or user-specific (e.g. a filter limited to
// particular course codes) since this template is shared by every install.
export const ASSIGNMENT_DATABASE_DEFAULT_SORTS = [
  { property: 'Checkbox', direction: 'ascending' },
  { property: 'Due Date', direction: 'ascending' },
  { property: 'Assignment Name', direction: 'ascending' }
];

// The one property Notion requires every database to have exactly one of. A
// database the user made themselves calls it "Name"; sync writes the
// assignment title here, so setup renames it rather than adding a second one
// (Notion allows only one title property per database).
export const ASSIGNMENT_DATABASE_TITLE_PROPERTY = 'Assignment Name';

/**
 * Work out what a database the user built themselves is missing, given the
 * schema Notion reports for its data source.
 *
 * Splits into three outcomes per column:
 *   - absent            → added to `updates`, so a PATCH creates it
 *   - present, right type → left alone (an existing Status select keeps the
 *                           user's own options; Notion adds any it doesn't have
 *                           when sync writes them)
 *   - present, wrong type → a conflict. Retyping would discard whatever the
 *                           user already has in that column, and Notion can't
 *                           produce some types (a status column, for one) at
 *                           all, so setup reports it instead of guessing.
 *
 * The title column is renamed rather than added, keyed by its property ID so
 * the rename cannot collide with a column being added under its old name.
 *
 * @param {Object} schema `properties` from a Notion data source
 * @returns {{updates: Object, added: string[], renamedTitleFrom: string|null,
 *            conflicts: Array<{name: string, actualType: string, expectedType: string}>}}
 */
export function planAssignmentSchemaUpdate(schema) {
  const existing = new Map(Object.entries(schema || {}));
  const updates = new Map();
  const added = [];
  const conflicts = [];
  let renamedTitleFrom = null;

  // The title column first: renaming it frees up its old name, which may itself
  // be a column sync needs (a database whose title property is called "Course",
  // say), so the rest is checked against the schema as it will be afterwards.
  const titleEntry = [...existing].find(([, definition]) => definition && definition.type === 'title');
  const claimedTitleName = existing.get(ASSIGNMENT_DATABASE_TITLE_PROPERTY);

  if (!titleEntry) {
    // No title property at all shouldn't happen, but adding one beats failing.
    updates.set(ASSIGNMENT_DATABASE_TITLE_PROPERTY, { title: {} });
    added.push(ASSIGNMENT_DATABASE_TITLE_PROPERTY);
    existing.set(ASSIGNMENT_DATABASE_TITLE_PROPERTY, { type: 'title' });
  } else if (titleEntry[0] !== ASSIGNMENT_DATABASE_TITLE_PROPERTY) {
    if (claimedTitleName) {
      conflicts.push({
        name: ASSIGNMENT_DATABASE_TITLE_PROPERTY,
        actualType: claimedTitleName.type,
        expectedType: 'title'
      });
    } else {
      // Keyed by property ID, not by its current name: freeing up a name that
      // is itself a column sync needs (a title property called "Course") would
      // otherwise collide with the entry adding that column back.
      renamedTitleFrom = titleEntry[0];
      updates.set(titleEntry[1].id ?? titleEntry[0], { name: ASSIGNMENT_DATABASE_TITLE_PROPERTY });
      existing.delete(titleEntry[0]);
      existing.set(ASSIGNMENT_DATABASE_TITLE_PROPERTY, titleEntry[1]);
    }
  }

  for (const [name, definition] of Object.entries(ASSIGNMENT_DATABASE_PROPERTIES)) {
    const expectedType = Object.keys(definition)[0];
    if (expectedType === 'title') continue; // handled above

    const current = existing.get(name);
    if (!current) {
      updates.set(name, definition);
      added.push(name);
    } else if (current.type !== expectedType) {
      conflicts.push({ name, actualType: current.type, expectedType });
    }
  }

  return {
    updates: Object.fromEntries(updates),
    added,
    renamedTitleFrom,
    conflicts
  };
}
