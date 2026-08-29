// Schema for the "Create Database" button in the popup: a Notion database
// with exactly the properties assignment-syncer.js writes to, so a freshly
// created database works for syncing with no manual column setup.

export const ASSIGNMENT_DATABASE_TITLE = 'Canvas Assignments';

export const ASSIGNMENT_DATABASE_PROPERTIES = {
  'Assignment Name': { title: {} },
  'Checkbox': { checkbox: {} },
  'Course': { select: {} },
  'Due Date': { date: {} },
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
  'Points': { number: { format: 'number' } },
  'Link to Resources': { url: {} },
  'Canvas ID': { rich_text: {} },
  'Grade': { number: { format: 'number' } },
  'Description': { rich_text: {} }
};

// Default view sort applied to a freshly created database: unchecked items
// first, then soonest due, then alphabetical as a final tiebreak. Deliberately
// excludes anything workspace- or user-specific (e.g. a filter limited to
// particular course codes) since this template is shared by every install.
export const ASSIGNMENT_DATABASE_DEFAULT_SORTS = [
  { property: 'Checkbox', direction: 'ascending' },
  { property: 'Due Date', direction: 'ascending' },
  { property: 'Assignment Name', direction: 'ascending' }
];
