# RepairOps AI

RepairOps AI is a CPS 5500 midterm prototype for a phone repair shop workflow. The app demonstrates a web dashboard with an AI agent that does operational work instead of only chatting.

## What The Agent Does

- Collects repair problem, device model, staff estimate, and technician result through a guided workflow.
- Keeps customer name and phone number local in the browser.
- Sends only repair-related, redacted data to OpenAI.
- Detects high-risk repair issues early, including water/liquid/spill, motherboard, logic board, HDMI board, no power, Face ID, fingerprint, and Touch ID.
- Creates a structured repair ticket, risk level, missing documentation list, warranty summary, follow-up draft, staff task, live monitor, and audit log.
- Generates a downloadable warranty acceptance PDF after the customer confirms the repaired device was received in working condition.

## Tech Stack

- Next.js
- React
- TypeScript
- OpenAI Responses API through server-side Next.js API routes
- Browser localStorage for prototype ticket persistence

## Privacy Design

Customer name and phone number are entered in the private local form before the agent starts. They are stored in browser localStorage for the prototype and are not sent directly to OpenAI. API requests use masked or private placeholders for customer fields.

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
```

Run the development server:

```bash
npm run dev -- -H 127.0.0.1 -p 3000 --webpack
```

Open:

```text
http://127.0.0.1:3000
```

## Deployment Notes

Do not commit `.env.local` or any real API key. For Vercel or Railway, add `OPENAI_API_KEY`, `OPENAI_MODEL`, and `DEMO_ACCESS_CODE` as environment variables in the hosting dashboard.

## Useful Commands

```bash
npm run lint
npm run build
```
