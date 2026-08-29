// Schema for the "Create Database" button in the popup: a Notion database
// with exactly the properties assignment-syncer.js writes to, so a freshly
// created database works for syncing with no manual column setup.

export const ASSIGNMENT_DATABASE_TITLE = 'Canvas Assignments';

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
