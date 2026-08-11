import { NextResponse } from "next/server";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WorkflowAction = "before_photo" | "pickup_email" | "after_photo" | "warranty_acceptance" | "review_request";
type JsonRecord = Record<string, unknown>;

type WorkflowPayload = {
  action?: WorkflowAction;
  ticketId?: string;
  customerName?: string;
  customerEmail?: string;
  device?: string;
  issue?: string;
  repairSummary?: string;
};

type AgentDecision = {
  agent: string;
  decision: string;
  reason: string;
  nextAction: string;
  modelMode: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    source: "measured" | "unavailable" | "fallback";
  };
  subject?: string;
  customerMessage?: string;
  warrantyStatement?: string;
};

const databaseDir = path.join(process.cwd(), "data", "local-database");

async function readJsonArray(fileName: string): Promise<JsonRecord[]> {
  try {
    const file = await readFile(path.join(databaseDir, fileName), "utf8");
    const parsed = JSON.parse(file);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function upsertJsonRecord(fileName: string, record: JsonRecord, key: string) {
  await mkdir(databaseDir, { recursive: true });
  const records = await readJsonArray(fileName);
  const recordKey = record[key];
  const existingIndex = records.findIndex((item) => item[key] === recordKey);
  const nextRecords =
    existingIndex >= 0
      ? records.map((item, index) => (index === existingIndex ? { ...item, ...record } : item))
      : [...records, record];

  await writeFile(path.join(databaseDir, fileName), `${JSON.stringify(nextRecords, null, 2)}\n`);

  return {
    fileName,
    recordKey,
    operation: existingIndex >= 0 ? "updated" : "inserted",
    totalRecords: nextRecords.length,
  };
}

async function sendEmail(to: string, subject: string, html: string, text?: string) {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_FROM?.trim() || "RepairOps AI <onboarding@resend.dev>";

  if (!apiKey || !to.includes("@")) {
    return {
      status: "local_outbox",
      provider: "local-json",
      messageId: `local-${Date.now()}`,
    };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; message?: string };

  if (!response.ok) {
    return {
      status: "send_failed",
      provider: "resend",
      messageId: body.id || `failed-${Date.now()}`,
      error: body.message || "Email provider rejected the request.",
    };
  }

  return {
    status: "sent",
    provider: "resend",
    messageId: body.id || `resend-${Date.now()}`,
  };
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function extractOutputText(responseBody: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  if (responseBody.output_text) return responseBody.output_text;
  return responseBody.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("") ?? "";
}

function parseJsonObject<T>(text: string): Partial<T> {
  try {
    return JSON.parse(text) as Partial<T>;
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]) as Partial<T>;
    } catch {
      return {};
    }
  }
}

async function runAgentReasoning(
  agent: string,
  task: string,
  context: Record<string, string>,
  fallbackDecision: string,
): Promise<AgentDecision> {
  const apiKey = process.env.OPENAI_API_KEY?.replace(/\s+/g, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const reasoningInput = {
    agent,
    task,
    context,
    requiredJsonShape: {
      decision: "short machine-readable decision",
      reason: "one short operational reason",
      nextAction: "one concrete next workflow action",
      subject: "optional email subject when this agent writes an email",
      customerMessage: "optional customer-facing message when this agent writes a customer communication",
      warrantyStatement: "optional warranty or pickup acceptance statement when this agent handles warranty",
    },
  };

  if (!apiKey) {
    return {
      agent,
      decision: fallbackDecision,
      reason: "Local deterministic fallback used because OPENAI_API_KEY is not configured.",
      nextAction: "Continue the controlled workflow action.",
      modelMode: "Local fallback",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "fallback" },
    };
  }

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: "developer",
            content:
              "You are one agent in a phone repair shop workflow. Return only compact JSON with decision, reason, and nextAction. Do not include private customer data.",
          },
          {
            role: "user",
            content: JSON.stringify(reasoningInput),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("OpenAI reasoning request failed");

    const body = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
    };
    const text = extractOutputText(body);
    const parsed = parseJsonObject<AgentDecision>(text);
    const inputTokens = body.usage?.input_tokens ?? 0;
    const outputTokens = body.usage?.output_tokens ?? 0;
    const usage =
      inputTokens || outputTokens
        ? {
            inputTokens,
            outputTokens,
            totalTokens: body.usage?.total_tokens ?? inputTokens + outputTokens,
            source: "measured" as const,
          }
        : { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "unavailable" as const };
    return {
      agent,
      decision: parsed.decision || fallbackDecision,
      reason: parsed.reason || "AI reasoning completed for this workflow step.",
      nextAction: parsed.nextAction || "Continue the controlled workflow action.",
      modelMode: model,
      usage,
      subject: parsed.subject,
      customerMessage: parsed.customerMessage,
      warrantyStatement: parsed.warrantyStatement,
    };
  } catch {
    return {
      agent,
      decision: fallbackDecision,
      reason: "Rule-checked safety decision used because the AI reasoning call was unavailable.",
      nextAction: "Continue the controlled workflow action.",
      modelMode: "Rule check",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "fallback" },
    };
  }
}

function emailShell(title: string, preview: string, body: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://repairops-ai.vercel.app";
  const logoUrl = `${appUrl.replace(/\/$/, "")}/tnf-logo-visible.png`;

  return `
    <!doctype html>
    <html>
      <body style="margin:0;background:#eef3f8;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#17212b;">
        <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preview)}</div>
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d8e4ef;border-radius:16px;overflow:hidden;box-shadow:0 12px 34px rgba(24,55,86,0.12);">
          <tr>
            <td style="background:#073d72;padding:22px 26px;">
              <img src="${logoUrl}" alt="Talk N Fix" width="180" style="display:block;max-width:180px;height:auto;background:#ffffff;border-radius:10px;padding:8px;" />
              <div style="margin-top:12px;color:#ffffff;font-size:20px;font-weight:900;letter-spacing:0.08em;">TALK N FIX</div>
              <div style="margin-top:3px;color:#b8daf8;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">Cherry Hill Repair Desk</div>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 26px 10px;">
              <p style="margin:0 0 8px;color:#0576d8;font-size:12px;font-weight:800;letter-spacing:0.04em;text-transform:uppercase;">Repair update</p>
              <h1 style="margin:0;color:#073d72;font-size:26px;line-height:1.2;">${escapeHtml(title)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:0 26px 28px;">
              ${body}
              <div style="margin-top:24px;padding-top:18px;border-top:1px solid #d8e4ef;color:#63778a;font-size:13px;line-height:1.5;">
                <strong style="color:#073d72;">Talk N Fix Cherry Hill</strong><br />
                Device repair status notification<br />
                <span style="color:#8b9bad;">Please reply or call the store if anything looks incorrect.</span>
              </div>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;
}

function buildPickupEmail(customerName: string, device: string, aiDecision?: AgentDecision) {
  const safeName = escapeHtml(customerName || "there");
  const safeDevice = escapeHtml(device);
  const rawAiMessage = aiDecision?.customerMessage?.trim() || "";
  const invalidReadyMessage =
    !rawAiMessage ||
    /will notify|notify you once|once .*complete|when .*complete|after .*complete|not ready|still being|in progress|we will let you know|we'll let you know|repair is complete soon|repair is still/i.test(
      rawAiMessage,
    );
  const aiMessage = invalidReadyMessage ? "" : rawAiMessage;
  const plainMessage =
    aiMessage || `Your ${device} repair is complete and ready for pickup at Talk N Fix.`;
  const message = aiMessage
    ? escapeHtml(aiMessage)
    : `Your ${safeDevice} repair is complete and ready for pickup at Talk N Fix.`;
  return {
    subject: `Talk N Fix pickup ready - ${device}`,
    text: `Hi ${customerName || "there"},\n\n${plainMessage}\n\nAt pickup, staff will help you inspect the repaired device, confirm it is working, review the limited warranty, and complete payment if needed.\n\nThank you,\nTalk N Fix Cherry Hill`,
    html: emailShell(
      `${safeDevice} is ready for pickup`,
      `Your ${safeDevice} repair is complete and ready for pickup.`,
      `
        <p style="margin:18px 0 0;font-size:16px;line-height:1.6;">Hi ${safeName},</p>
        <p style="margin:12px 0 0;font-size:16px;line-height:1.6;">${message}</p>
        <div style="margin:22px 0;padding:18px;border:1px solid #b8daf8;border-radius:12px;background:#f8fbfe;">
          <p style="margin:0 0 10px;color:#073d72;font-size:14px;font-weight:800;">At pickup, staff will help you:</p>
          <ol style="margin:0;padding-left:20px;color:#31536f;font-size:15px;line-height:1.7;">
            <li>Inspect the repaired device.</li>
            <li>Confirm the device is working at pickup.</li>
            <li>Review and sign the limited warranty.</li>
            <li>Complete payment if still pending.</li>
          </ol>
        </div>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#31536f;">Thank you for choosing Talk N Fix. We appreciate your business.</p>
      `,
    ),
  };
}

function buildReviewEmail(customerName: string, device: string, aiDecision?: AgentDecision) {
  const safeName = escapeHtml(customerName || "there");
  const safeDevice = escapeHtml(device);
  const reviewUrl = "https://maps.app.goo.gl/4pDXg72XAWmL63X6A";
  const aiMessage = aiDecision?.customerMessage?.trim();
  const plainMessage =
    aiMessage ||
    `Thank you for picking up your repaired ${device}. If everything is working well, we would really appreciate a quick Google review.`;
  const message = aiMessage
    ? escapeHtml(aiMessage)
    : `Thank you for picking up your repaired ${safeDevice}. If everything is working well, we would really appreciate a quick Google review.`;
  return {
    subject: aiDecision?.subject?.trim() || "Thank you from Talk N Fix",
    text: `Hi ${customerName || "there"},\n\n${plainMessage}\n\nLeave a Google Review: ${reviewUrl}\n\nThank you,\nTalk N Fix Cherry Hill`,
    html: emailShell(
      "Thank you for visiting Talk N Fix",
      `Thank you for picking up your repaired ${safeDevice}.`,
      `
        <p style="margin:18px 0 0;font-size:16px;line-height:1.6;">Hi ${safeName},</p>
        <p style="margin:12px 0 0;font-size:16px;line-height:1.6;">${message}</p>
        <div style="margin:22px 0;padding:18px;border:1px solid #b7e4cf;border-radius:12px;background:#f4fbf7;">
          <p style="margin:0 0 16px;color:#12744d;font-size:15px;line-height:1.6;">Your feedback helps a small local repair shop and helps future customers find reliable repair service.</p>
          <a href="${reviewUrl}" style="display:inline-block;background:#073d72;color:#ffffff;text-decoration:none;border-radius:10px;padding:12px 18px;font-size:14px;font-weight:800;">Leave a Google Review</a>
        </div>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#31536f;">Thank you again for choosing Talk N Fix.</p>
        <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#63778a;">Review link: <a href="${reviewUrl}" style="color:#075fb1;">${reviewUrl}</a></p>
      `,
    ),
  };
}

export async function POST(request: Request) {
  const payload = (await request.json()) as WorkflowPayload;
  const action = payload.action;
  const now = new Date().toISOString();
  const ticketId = payload.ticketId || "R-LIVE-1001";
  const customerName = payload.customerName || "Walk-in customer";
  const customerEmail = payload.customerEmail || "";
  const device = payload.device || "device";
  const issue = payload.issue || "Repair issue not provided.";
  const repairSummary = payload.repairSummary || "Repair result not provided.";

  if (action === "before_photo") {
    const aiDecision = await runAgentReasoning(
      "Repair Workflow Agent",
      "Decide whether the drop-off case can start after before-photo proof is recorded.",
      { ticketId, device, issue, proof: "before photo metadata recorded" },
      "dropoff_proof_accepted",
    );
    const repairCase = {
      ticket_id: ticketId,
      customer_label: customerName,
      customer_email: customerEmail,
      device,
      issue,
      intake_status: "before_photo_proof_recorded",
      updated_at: now,
    };
    const photoRecord = {
      photo_id: `before-photo-${ticketId}`,
      ticket_id: ticketId,
      photo_type: "before",
      storage_mode: "prototype-metadata-only",
      file_label: `${ticketId}-before-photo-proof`,
      description: "Before-condition photo proof metadata recorded at drop-off. No image file is stored in this prototype.",
      created_at: now,
    };
    const writeResults = [
      await upsertJsonRecord("repair_cases.json", repairCase, "ticket_id"),
      await upsertJsonRecord("repair_photos.json", photoRecord, "photo_id"),
      await upsertJsonRecord(
        "agent_activity_logs.json",
        {
          activity_id: `repair-agent-before-photo-${ticketId}`,
          ticket_id: ticketId,
          agent: "Repair Workflow Agent",
          action: "Recorded before photo proof metadata and opened repair case",
          status: "before_photo_proof_recorded",
          ai_decision: aiDecision,
          created_at: now,
        },
        "activity_id",
      ),
    ];

    return NextResponse.json({ ok: true, action, aiDecision, repairCase, photoRecord, databaseWrites: writeResults });
  }

  if (action === "pickup_email") {
    const aiDecision = await runAgentReasoning(
      "Pickup Email Agent",
      "The repair is already complete and the device is ready for pickup now. Write a concise customer-facing pickup email subject and message. The customerMessage must clearly say the repaired device is ready for pickup now. Never say the shop will notify the customer later. Never say the repair is still in progress. Never use uncertain language.",
      { ticketId, device, issue, repairSummary, requiredStatus: "ready_for_pickup_now" },
      "pickup_email_ready",
    );
    const email = buildPickupEmail(customerName, device, aiDecision);
    const sendResult = await sendEmail(customerEmail, email.subject, email.html, email.text);
    const event = {
      email_event_id: `pickup-${ticketId}`,
      ticket_id: ticketId,
      customer_email: customerEmail,
      subject: email.subject,
      body_html: email.html,
      body_text: email.text,
      provider: sendResult.provider,
      provider_message_id: sendResult.messageId,
      status: sendResult.status,
      error: "error" in sendResult ? sendResult.error : "",
      created_at: now,
    };
    const writeResults = [
      await upsertJsonRecord("pickup_email_events.json", event, "email_event_id"),
      await upsertJsonRecord(
        "agent_activity_logs.json",
        {
          activity_id: `pickup-email-agent-${ticketId}`,
          ticket_id: ticketId,
          agent: "Pickup Email Agent",
          action: "Sent or queued pickup-ready email",
          status: sendResult.status,
          ai_decision: aiDecision,
          created_at: now,
        },
        "activity_id",
      ),
    ];

    return NextResponse.json({ ok: true, action, aiDecision, emailEvent: event, databaseWrites: writeResults });
  }

  if (action === "after_photo") {
    const aiDecision = await runAgentReasoning(
      "Warranty Agent",
      "Decide if after-repair proof and technician notes are sufficient before warranty signature, then write a concise warrantyStatement for the customer acceptance record. Include 90-day limited warranty and exclude physical damage, water damage, and customer-caused damage.",
      { ticketId, device, issue, repairSummary },
      "after_proof_ready_for_signature",
    );
    const repairCase = {
      ticket_id: ticketId,
      customer_label: customerName,
      customer_email: customerEmail,
      device,
      issue,
      intake_status: "after_photo_proof_recorded",
      updated_at: now,
    };
    const photoRecord = {
      photo_id: `after-photo-${ticketId}`,
      ticket_id: ticketId,
      photo_type: "after",
      storage_mode: "prototype-metadata-only",
      file_label: `${ticketId}-after-photo-proof`,
      description: "After-repair photo proof metadata recorded before warranty signature. No image file is stored in this prototype.",
      created_at: now,
    };
    const technicianNote = {
      note_id: `technician-note-${ticketId}`,
      ticket_id: ticketId,
      device,
      note_text: repairSummary,
      tests_completed: ["display", "touch", "camera", "speaker", "charging"],
      created_at: now,
    };
    const writeResults = [
      await upsertJsonRecord("repair_cases.json", repairCase, "ticket_id"),
      await upsertJsonRecord("repair_photos.json", photoRecord, "photo_id"),
      await upsertJsonRecord("technician_notes.json", technicianNote, "note_id"),
      await upsertJsonRecord(
        "agent_activity_logs.json",
        {
          activity_id: `warranty-agent-after-photo-${ticketId}`,
          ticket_id: ticketId,
          agent: "Warranty Agent",
          action: "Recorded after photo proof metadata and technician proof before warranty signature",
          status: "after_photo_proof_recorded",
          ai_decision: aiDecision,
          created_at: now,
        },
        "activity_id",
      ),
    ];

    return NextResponse.json({ ok: true, action, aiDecision, repairCase, photoRecord, technicianNote, databaseWrites: writeResults });
  }

  if (action === "warranty_acceptance") {
    const aiDecision = await runAgentReasoning(
      "Warranty Agent",
      "Confirm warranty acceptance can hand the case to payment and write the final warrantyStatement saved to the pickup record.",
      { ticketId, device, issue, repairSummary, warranty: "customer accepted working-condition pickup statement" },
      "warranty_signed_handoff_to_payment",
    );
    const acceptance = {
      acceptance_id: `warranty-${ticketId}`,
      ticket_id: ticketId,
      customer_name: customerName,
      device,
      statement:
        aiDecision.warrantyStatement ||
        "Customer received the repaired device in working condition and accepted pickup warranty terms.",
      status: "signed",
      signed_at: now,
    };
    const writeResults = [
      await upsertJsonRecord("warranty_acceptances.json", acceptance, "acceptance_id"),
      await upsertJsonRecord(
        "agent_activity_logs.json",
        {
          activity_id: `warranty-agent-${ticketId}`,
          ticket_id: ticketId,
          agent: "Warranty Agent",
          action: "Captured pickup warranty acceptance",
          status: "signed",
          ai_decision: aiDecision,
          created_at: now,
        },
        "activity_id",
      ),
    ];

    return NextResponse.json({ ok: true, action, aiDecision, warrantyAcceptance: acceptance, databaseWrites: writeResults });
  }

  if (action === "review_request") {
    const aiDecision = await runAgentReasoning(
      "Review Follow-up Agent",
      "Decide if the completed paid repair is ready for a review follow-up email, then write a concise customer-facing thank-you/review email subject and message.",
      { ticketId, device, issue, repairSummary },
      "review_followup_ready",
    );
    const email = buildReviewEmail(customerName, device, aiDecision);
    const sendResult = await sendEmail(customerEmail, email.subject, email.html, email.text);
    const reviewRequest = {
      review_request_id: `review-${ticketId}`,
      ticket_id: ticketId,
      customer_email: customerEmail,
      subject: email.subject,
      body_html: email.html,
      body_text: email.text,
      provider: sendResult.provider,
      provider_message_id: sendResult.messageId,
      status: sendResult.status,
      error: "error" in sendResult ? sendResult.error : "",
      created_at: now,
    };
    const writeResults = [
      await upsertJsonRecord("review_requests.json", reviewRequest, "review_request_id"),
      await upsertJsonRecord(
        "agent_activity_logs.json",
        {
          activity_id: `review-agent-${ticketId}`,
          ticket_id: ticketId,
          agent: "Review Follow-up Agent",
          action: "Sent or queued post-payment review follow-up",
          status: sendResult.status,
          ai_decision: aiDecision,
          created_at: now,
        },
        "activity_id",
      ),
    ];

    return NextResponse.json({ ok: true, action, aiDecision, reviewRequest, databaseWrites: writeResults });
  }

  return NextResponse.json({ ok: false, message: "Unknown workflow action." }, { status: 400 });
}
