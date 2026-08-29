// Schema for the "Create Database" button in the popup: a Notion database
// with exactly the properties assignment-syncer.js writes to, so a freshly
// created database works for syncing with no manual column setup.

export const ASSIGNMENT_DATABASE_TITLE = 'Canvas Assignments';

export const ASSIGNMENT_DATABASE_PROPERTIES = {
  'Assignment Name': { title: {} },
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

// Default view sort applied to a freshly created database: soonest due first,
// then alphabetical as a tiebreak. Deliberately excludes anything workspace- or
// user-specific (e.g. a filter limited to particular course codes) since this
// template is shared by every install of the extension.
export const ASSIGNMENT_DATABASE_DEFAULT_SORTS = [
  { property: 'Due Date', direction: 'ascending' },
  { property: 'Assignment Name', direction: 'ascending' }
];
