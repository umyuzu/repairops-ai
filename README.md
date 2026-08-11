# RepairOps AI

RepairOps AI is a CPS 5500 phone repair shop workflow dashboard for Talk N Fix. The app demonstrates a web application with a team of AI agents that perform operational work, pass work to the next agent, and show each decision in an audit log.

## What The Agent Team Does

- Collects repair problem, device model, staff estimate, before-photo proof, and technician result through a guided workflow.
- Keeps customer name and phone number local in the browser.
- Sends only repair-related, redacted data to OpenAI.
- Detects high-risk repair issues early, including water/liquid/spill, motherboard, logic board, HDMI board, no power, Face ID, fingerprint, and Touch ID.
- Creates a structured repair ticket, risk level, missing documentation list, warranty summary, customer email draft, staff task, live monitor, and audit log.
- Sends pickup and review emails through Resend when email credentials are configured.
- Reads a Square Sandbox payment through the Square API and stores raw and cleaned payment records.
- Shows OpenAI token usage for each agent step when the API returns usage metadata.
- Generates a downloadable warranty acceptance PDF after the customer confirms the repaired device was received in working condition.

## Agent Loop

The final project extends the midterm into a multi-agent repair operations workflow. The agent team includes:

- Repair Workflow Agent
- Pickup Email Agent
- Warranty Agent
- Square Payment Agent
- Review Follow-up Agent

The dashboard includes a step-by-step multi-agent loop. Each agent receives an input, makes an operational decision, saves output, and hands the case to the next agent.

The Square Payment Agent reads from `/api/square-sandbox`. When Square Sandbox credentials are configured, the endpoint creates a sandbox card payment and stores a Square-style `payment.created` event plus a cleaned payment record. This keeps the class project safe while matching the database flow planned for Independent Study:

```text
Square Sandbox webhook JSON
-> raw_square_events
-> square_events_cleaned
-> payments
-> Payment Agent decision
```

During local development, workflow endpoints write safe class data into JSON database files:

- `data/local-database/raw_square_events.json`
- `data/local-database/square_events_cleaned.json`
- `data/local-database/payments.json`
- `data/local-database/pickup_email_events.json`
- `data/local-database/warranty_acceptances.json`
- `data/local-database/review_requests.json`
- `data/local-database/agent_activity_logs.json`
- `data/local-database/etl_runs.json`

These files provide visible database evidence for the Independent Study direction before moving the same schema into PostgreSQL and MongoDB.

## Tech Stack

- Next.js
- React
- TypeScript
- OpenAI Responses API through server-side Next.js API routes
- Resend for pickup and review email delivery
- Square Sandbox for payment workflow testing
- Browser localStorage for prototype ticket persistence
- JSON files for local prototype database evidence

## Privacy Design

Customer name and phone number are entered in the private local form before the agent starts. They are stored in browser localStorage for the prototype and are not sent directly to OpenAI. API requests use masked or private placeholders for customer fields. Email is used for the pickup and review workflow only.

This is a course prototype. A production version should replace localStorage with a database, add authentication, and store warranty PDFs in secure object storage.

## Local Setup

Install dependencies:

```bash
npm install
```

Create `.env.local`:

```bash
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_MODEL=gpt-4o-mini
DEMO_ACCESS_CODE=your_demo_code_here
RESEND_API_KEY=your_resend_api_key_here
EMAIL_FROM="Talk N Fix <no-reply@demo.yourdomain.com>"
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3001
SQUARE_SANDBOX_ACCESS_TOKEN=your_square_sandbox_access_token_here
SQUARE_LOCATION_ID=your_square_sandbox_location_id_here
```

Run the development server:

```bash
npm run dev -- -H 127.0.0.1 -p 3001 --webpack
```

Open:

```text
http://127.0.0.1:3001
```

## Deployment Notes

Do not commit `.env.local` or any real API key. For Vercel or Railway, add the OpenAI, Resend, Square Sandbox, and demo access code environment variables in the hosting dashboard.

## Useful Commands

```bash
npm run lint
npm run build
```
