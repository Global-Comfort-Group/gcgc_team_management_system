/**
 * Hardcoded FAQ content for the floating HelpWidget.
 *
 * To edit the help guides, change this file only — no component logic lives here.
 * Each entry's `answer` may contain multiple lines; blank lines render as
 * paragraph breaks and lines starting with "- " render as bullet steps.
 *
 * Keep the wording in step with the UI: button and menu names below are quoted
 * exactly as they appear on screen (last aligned 2026-09-17).
 */

export interface FaqEntry {
  id: string
  question: string
  answer: string
  /** Extra terms used by the search box (not shown to the user). */
  keywords?: string[]
}

export interface FaqCategory {
  id: string
  title: string
  entries: FaqEntry[]
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    entries: [
      {
        id: 'purpose',
        question: 'What is this system for?',
        answer:
          'The GCGC Team Management System keeps your team\'s work in one place.\n\nPlan tasks on boards, assign them to people or board roles, review and rate finished work, and see deadlines on a shared calendar.',
        keywords: ['about', 'purpose', 'overview', 'what is'],
      },
      {
        id: 'navigate',
        question: 'How do I navigate the portal?',
        answer:
          'Use the sidebar on the left:\n- Dashboard — your summary and what needs attention.\n- Tasks — boards, the task list, Archive and Export.\n- Teams — the teams you belong to and their boards.\n- Calendar — task deadlines and synced Google events.\n- Evaluations — your evaluation scores.\n- Profile — your details and notification settings.\n\nLeaders also see Team Overview and Member Management. On a phone, tap the menu button at the top-left to open the sidebar. Use the search bar at the top to jump straight to a task.',
        keywords: ['menu', 'sidebar', 'navigation', 'move around', 'search'],
      },
      {
        id: 'roles',
        question: 'What can Leaders and Members do?',
        answer:
          '- Members work on the tasks assigned to them, update progress, comment, and submit work for review.\n- Leaders also create and manage teams and boards, assign work, approve or send back submitted tasks, rate work quality, and see their team in Team Overview and Member Management.\n\nAnyone on a board can open its tasks — including teammates\' tasks, their attachments and comments.',
        keywords: ['leader', 'member', 'permission', 'access', 'forbidden'],
      },
    ],
  },
  {
    id: 'tasks',
    title: 'Tasks',
    entries: [
      {
        id: 'add-task',
        question: 'How do I add a task?',
        answer:
          'On the Tasks page, click "New Task".\n- Board: choose which board the task goes on, or "No board". It starts on the board you have open.\n- Template (optional): pick one of the board\'s templates to pre-fill the form, or leave it on None.\n- Enter a title and a deadline (required), plus any description, priority or attachments.\n- Under Assigned To, pick People or a Role (see "Assigning Work").\n- Click "Create Task".\n\nUnder "More options" you can set an SLA target and deadline reminders: type a number and choose hours or days (for example 2 days before the due date). Assignees get a notification and an email at each reminder.\n\nEvery task gets a ticket number (for example OPS-14) that you can quote to find it later. If something is missing or wrong, a message pops up and the form scrolls to the field that needs fixing — nothing you typed is lost.',
        keywords: ['create task', 'new task', 'add card', 'board', 'ticket', 'id'],
      },
      {
        id: 'task-status',
        question: "How do I change a task's status?",
        answer:
          'Drag the card to another column on the board, or open the task and change its status there.\n\nThe standard columns are To Do, In Progress, In Review and Completed — a board may add its own. When you finish your part, move the task to In Review so your leader can approve it.',
        keywords: ['move task', 'progress', 'kanban', 'drag', 'done', 'complete'],
      },
      {
        id: 'task-details',
        question: 'What can I do inside a task?',
        answer:
          'Click a card to open it. The details are on the left and the comments on the right (below the details on a phone).\n- Update progress, subtasks, dependencies, attachments and PR / PO records.\n- Comment, reply, react, attach a file, and type @ to mention someone on the task\'s board.\n- Use "Duplicate" to copy the task, "Move" to send it to another board, or "Edit" to change it.',
        keywords: ['comments', 'mention', 'attachment', 'duplicate', 'move', 'edit', 'details'],
      },
      {
        id: 'schedule-health',
        question: 'What do Overdue, Delayed, On Track and Ahead mean?',
        answer:
          '- Overdue — past its deadline and not finished.\n- Delayed — finished, but after the deadline.\n- On Track — due in the future and progressing.\n- Ahead — finished before the deadline.',
        keywords: ['overdue', 'delayed', 'late', 'badge', 'on track', 'ahead'],
      },
      {
        id: 'backlog',
        question: 'What is the Archive?',
        answer:
          'The Archive holds each board\'s hidden tasks. Archived tasks leave the board without being deleted; open them with the "Archive" button on the Tasks page.\n\nCompleted tasks move to the Archive automatically 5 days after they are completed. Restoring a task puts it back exactly as it was — a completed task comes back as Completed.',
        keywords: ['archive', 'hide task', 'later', 'restore', 'disappeared', 'missing', 'auto'],
      },
      {
        id: 'export',
        question: 'Can I export tasks to Excel?',
        answer:
          'Yes. On the Tasks page click "Export". You get an .xlsx of the board you have open (or All Tasks), with your current filters applied.\n\nTo create tasks from a spreadsheet, click "Import", choose the board, and upload an .xlsx or .csv with the same columns as the export (or download the "Template"). Title and Due Date are required. You see a preview of every row, with anything that needs fixing, before any task is created. Ticket, Board and Created are ignored: every row becomes a new task.',
        keywords: ['excel', 'xlsx', 'csv', 'download', 'report', 'export', 'import', 'upload', 'bulk create'],
      },
    ],
  },
  {
    id: 'assigning',
    title: 'Assigning Work',
    entries: [
      {
        id: 'people-or-role',
        question: 'Should I assign a task to people or to a role?',
        answer:
          'In New Task, "Assigned To" has two options — pick one:\n- People: name one or more people. Leave it empty to assign it to yourself.\n- Role: send it to a board role such as "QA". Everyone who holds that role is assigned to the task.\n\nA role with nobody in it can\'t take work — add holders first.',
        keywords: ['assign', 'assignee', 'role', 'people', 'assigned to'],
      },
      {
        id: 'claim',
        question: 'A task still says "Waiting on" a role — what do I do?',
        answer:
          'Tasks sent to a role are now assigned to every holder automatically. Older tasks created before that change may still show "Waiting on" and a "Claim" button. If you hold the role, click "Claim" to take it.',
        keywords: ['claim', 'take', 'unclaimed', 'waiting on', 'role'],
      },
      {
        id: 'board-roles',
        question: 'How do I set up board roles?',
        answer:
          'Leaders: open the board, click "Customize", then the "roles" tab.\n- Create a role and choose what it may do.\n- Add holders — only people on that board (Leaders and Members) can be added.',
        keywords: ['roles', 'customize', 'board settings', 'holder', 'permissions'],
      },
    ],
  },
  {
    id: 'subtasks',
    title: 'Subtasks & Cascading',
    entries: [
      {
        id: 'subtasks',
        question: 'How do subtasks work?',
        answer:
          'Break a task into smaller pieces from the "Subtasks" section in New Task, or with "Add Subtask" in an open task.\n\nEach subtask can go to a person, to a board role, or to "Same as task", which follows the main task: its role if it has one, otherwise its first assigned person. You can change it for each subtask. The main task\'s progress follows its subtasks.',
        keywords: ['subtask', 'checklist', 'break down', 'same as task', 'role'],
      },
      {
        id: 'cascading',
        question: 'What is a cascading task?',
        answer:
          'A cascading task is a set of steps done in order. Turn on "Cascading" in New Task and add the steps. Only the first step is open; each one unlocks when the step before it is completed.\n\nLike subtasks, each step can go to a person, a role, or "Same as task". Recurring and Cascading can\'t both be on — choose one.',
        keywords: ['cascade', 'steps', 'sequence', 'order', 'locked', 'unlock'],
      },
      {
        id: 'templates',
        question: 'How do task templates work?',
        answer:
          'A board can have several templates, such as "PO Template" and "PR Template". In New Task, choose one under Template (or None). It pre-fills the title, description, priority, weight, SLA, role and a checklist. Switching templates replaces what the previous one filled in.\n\nChecklist items become subtasks — or steps, if the task is cascading — and default to "Same as task". Everything can be changed before you save.\n\nLeaders manage templates under "Customize" → "templates": pick a template to edit or click "New template", give it a name, and save.',
        keywords: ['template', 'default', 'prefilled', 'checklist', 'po', 'pr'],
      },
    ],
  },
  {
    id: 'reviews',
    title: 'Reviews & Ratings',
    entries: [
      {
        id: 'review-flow',
        question: 'How does a task get approved?',
        answer:
          'When you finish, move the task to In Review. The person who reviews it sees "This task is awaiting your review." above the progress bar, with two buttons:\n- "Approve" completes the task.\n- "Send back" returns it to In Progress for more work.\n\nEvery leader on the board can approve, rate and edit its tasks. A board role with "Approve work" lets other people approve too, but never their own work.',
        keywords: ['approve', 'send back', 'in review', 'reviewer', 'submit'],
      },
      {
        id: 'rating',
        question: 'How are tasks rated?',
        answer:
          'Leaders rate work quality from 1 to 5 under "Work Quality" on a task that is In Review or Completed. A rating is required before a task can be completed. A more senior leader can override the rating.\n\nEach rating is saved to the assignee\'s evaluation record automatically (1 = 0%, 2 = 25%, 3 = 50%, 4 = 75%, 5 = 100%).',
        keywords: ['rating', 'quality', 'score', 'grade', 'stars', '1-5'],
      },
      {
        id: 'grades',
        question: 'Where can I see a member\'s grades?',
        answer:
          'Open Evaluations in the sidebar. Members see their own evaluations; leaders see their team members\' grades, including task ratings, and can add an evaluation for anyone on their team. Scores run from 1 to 5.\n\nTo go straight to one person, open Team Overview, open the member\'s "…" menu and choose "Evaluate". Team Overview also shows each member\'s latest score.',
        keywords: ['evaluation', 'grades', 'performance', 'score', 'team overview'],
      },
    ],
  },
  {
    id: 'teams-boards',
    title: 'Teams & Boards',
    entries: [
      {
        id: 'create-team',
        question: 'How do I create a team?',
        answer:
          'Go to Teams and click "New Team". Each team gets its own task board.\n- Click "Invite member" to invite people, and set each one as Leader or Member.\n\nAn invited person gets a notification and an email, and joins only after clicking Accept (on their Dashboard, Teams or Notifications page). Until then they are listed as "Invited — waiting", where a leader can cancel the invite. Members also appear under the board\'s leaders in Team Overview.',
        keywords: ['new team', 'add team', 'members', 'invite', 'invitation', 'accept', 'decline', 'team overview'],
      },
      {
        id: 'create-board',
        question: 'How do I create a personal board?',
        answer:
          'On the Tasks page, open the board switcher and click "New personal board". Give it a name and create it. A team\'s board is created together with the team.',
        keywords: ['new board', 'kanban board', 'add board', 'personal'],
      },
      {
        id: 'customize-board',
        question: 'How do I customize a board?',
        answer:
          'Leaders: open the board and click "Customize". The tabs are:\n- statuses — the board\'s columns. Every board starts with To Do, In Progress, In Review and Completed; rename, recolor, reorder or delete any of them, as long as each kind keeps at least one.\n- fields — extra fields shown on tasks.\n- forms — request forms for the board.\n- roles — board roles and their holders.\n- templates — named templates people can pick in New Task.\n\n"Project info" on the same bar tracks the board\'s weighted measurements and quarterly targets.',
        keywords: ['customize', 'settings', 'columns', 'fields', 'statuses', 'roles', 'project info'],
      },
      {
        id: 'board-categories',
        question: 'What are board categories?',
        answer:
          'Categories are personal labels that group boards in your board switcher. Only you see them. Use the star to pin the boards you use most.',
        keywords: ['label', 'group boards', 'organize', 'pin', 'star'],
      },
    ],
  },
  {
    id: 'calendar',
    title: 'Calendar',
    entries: [
      {
        id: 'add-event',
        question: 'How do I add something to the calendar?',
        answer:
          'Task deadlines appear on the calendar automatically. To add one from the calendar:\n- Click a date to open that day.\n- Click "Add task" and fill in the task as usual.',
        keywords: ['new event', 'schedule', 'meeting', 'create event', 'deadline'],
      },
      {
        id: 'google-sync',
        question: 'How does Google Calendar sync work?',
        answer:
          'Click "Google Calendar Sync" on the Calendar page and connect your Google account. Your task deadlines are then sent to Google automatically.\n\nChanges made in Google are imported whenever you open the calendar, or right away with "Sync now".',
        keywords: ['google', 'sync', 'import', 'export', 'integration', 'gmail'],
      },
    ],
  },
  {
    id: 'account',
    title: 'Notifications & Account',
    entries: [
      {
        id: 'notifications',
        question: 'How do I get notified?',
        answer:
          'The bell in the sidebar lists your notifications. Under Profile → Notifications you can:\n- Turn email notifications on or off, and use its "Send test" to check emails arrive. Every notification in the app is also emailed while this is on.\n- Enable browser push notifications, then use "Send test" to check they arrive.',
        keywords: ['notification', 'push', 'email', 'bell', 'alerts'],
      },
      {
        id: 'forbidden',
        question: 'Why do I see "Forbidden" or "Not found" on a task?',
        answer:
          'You can open a task only if you are on its board or directly involved in it. Ask the board\'s leader to add you to the team. If you were just added, refresh the page.',
        keywords: ['forbidden', 'error', 'access denied', '403', 'cannot open'],
      },
    ],
  },
]
