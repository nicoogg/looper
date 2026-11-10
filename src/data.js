// Example loops shown on the site and known to the chat.
// They describe the kind of task people record, not hosted integrations.
export const LOOPS = [
  {
    id: 'place_order',
    site: 'Supplier portal',
    tool: 'place_order(sku, qty, note)',
    mode: 'api',
    desc: 'Orders stock from a B2B portal with no public API.\nThe CSRF token and account id are found for you.',
  },
  {
    id: 'find_customer',
    site: 'Old CRM',
    tool: 'find_customer(name)',
    mode: 'api',
    desc: 'Searches an in-house CRM and returns the matching records as JSON.',
  },
  {
    id: 'book_room',
    site: 'Intranet',
    tool: 'book_room(room, date, hours)',
    mode: 'api',
    desc: 'Books a meeting room on the company intranet in one call.',
  },
  {
    id: 'download_invoice',
    site: 'Accountant portal',
    tool: 'download_invoice(month)',
    mode: 'api',
    desc: 'Fetches the invoice list for a month straight from the portal endpoint.',
  },
  {
    id: 'update_stock',
    site: 'Shop admin',
    tool: 'update_stock(product, qty)',
    mode: 'api',
    desc: 'Changes stock levels in an admin panel without opening it.',
  },
  {
    id: 'submit_timesheet',
    site: 'Legacy timesheet',
    tool: 'submit_timesheet(day, hours)',
    mode: 'ui',
    desc: 'A server-rendered form with no API calls.\nLooper replays the clicks instead.',
  },
]

export const COMMANDS = [
  ['record <name> <url>', 'Do the task once in a real browser'],
  ['run <name> key=value', 'Repeat it from the terminal'],
  ['serve', 'Every loop becomes an MCP tool'],
  ['login <url>', 'Refresh a session that expired'],
]
