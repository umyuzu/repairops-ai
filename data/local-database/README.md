# Local Database Output

This folder stores local JSON database records created by the Square Sandbox workflow during development.

When the dashboard reads `/api/square-sandbox`, the route writes:

- `raw_square_events.json` for original Square-style webhook payloads
- `square_events_cleaned.json` for ETL-cleaned event records
- `payments.json` for payment records used by the Payment Agent
- `pickup_email_events.json` for pickup-ready email events
- `warranty_acceptances.json` for customer pickup warranty signatures
- `review_requests.json` for post-payment review follow-up events
- `agent_activity_logs.json` for agent decisions and actions
- `etl_runs.json` for a small audit trail of local ETL/database writes

These files are safe class data. They do not contain real cards, real payments, or real customer data.
