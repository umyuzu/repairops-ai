import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/postgres";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;
type DatabaseWriteResult = {
  fileName: string;
  recordKey?: unknown;
  operation: string;
  totalRecords?: number;
};

type SquarePayment = {
  id: string;
  status: "APPROVED" | "PENDING" | "COMPLETED";
  source_type?: string;
  card_details?: {
    card?: {
      last_4?: string;
      card_brand?: string;
    };
  };
  amount_money: {
    amount: number;
    currency: string;
  };
  note?: string;
  receipt_number?: string;
  receipt_url?: string;
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
};

const databaseDir = path.join(process.cwd(), "data", "local-database");

function formatMoney(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
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

async function runPaymentAgentReasoning(ticketId: string, expectedAmountCents: number, payment: SquarePayment): Promise<AgentDecision> {
  const apiKey = process.env.OPENAI_API_KEY?.replace(/\s+/g, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const fallbackDecision =
    payment.status === "COMPLETED" && payment.amount_money.amount === expectedAmountCents
      ? "payment_confirmed"
      : "payment_needs_review";
  const reasoningInput = {
    ticketId,
    expectedAmountCents,
    squarePayment: {
      id: payment.id,
      status: payment.status,
      amountCents: payment.amount_money.amount,
      currency: payment.amount_money.currency,
      sourceType: payment.source_type,
      receiptNumber: payment.receipt_number,
    },
    requiredJsonShape: {
      decision: "payment_confirmed | amount_mismatch | payment_pending | payment_needs_review",
      reason: "one short operational reason",
      nextAction: "one concrete next workflow action",
    },
  };

  if (!apiKey) {
    return {
      agent: "Square Payment Agent",
      decision: fallbackDecision,
      reason: "Local deterministic payment check used because OPENAI_API_KEY is not configured.",
      nextAction: fallbackDecision === "payment_confirmed" ? "Generate receipt record and wait for review handoff." : "Hold review handoff.",
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
              "You are the Square Payment Agent for a repair shop workflow. Return only compact JSON with decision, reason, and nextAction.",
          },
          {
            role: "user",
            content: JSON.stringify(reasoningInput),
          },
        ],
      }),
    });
    if (!response.ok) throw new Error("OpenAI payment reasoning failed");
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
      agent: "Square Payment Agent",
      decision: parsed.decision || fallbackDecision,
      reason: parsed.reason || "AI checked the Square payment response.",
      nextAction: parsed.nextAction || "Generate receipt record and wait for review handoff.",
      modelMode: model,
      usage,
    };
  } catch {
    return {
      agent: "Square Payment Agent",
      decision: fallbackDecision,
      reason: "Rule-checked payment decision used because the AI reasoning call was unavailable.",
      nextAction: fallbackDecision === "payment_confirmed" ? "Generate receipt record and wait for review handoff." : "Hold review handoff.",
      modelMode: "Rule check",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: "fallback" },
    };
  }
}

function makePaymentEvent(ticketId: string, payment: SquarePayment, source: string) {
  const now = new Date().toISOString();

  return {
    merchant_id: process.env.SQUARE_MERCHANT_ID?.trim() || "sandbox-merchant",
    type: "payment.created",
    event_id: `payment-created-${payment.id}`,
    created_at: now,
    source,
    data: {
      type: "payment",
      id: payment.id,
      object: {
        payment: {
          ...payment,
          note: payment.note || `RepairOps ticket ${ticketId}`,
          receipt_number: payment.receipt_number || `sandbox-receipt-${ticketId}`,
        },
      },
    },
  };
}

function makeFallbackPayment(ticketId: string, amountCents: number): SquarePayment {
  return {
    id: `sandbox-demo-${ticketId}`,
    status: "COMPLETED",
    source_type: "CARD",
    amount_money: {
      amount: amountCents,
      currency: "USD",
    },
    note: `RepairOps ticket ${ticketId}`,
    receipt_number: `local-demo-${ticketId}`,
  };
}

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
  const records = await readJsonArray(fileName);
  const recordKey = record[key];
  const existingIndex = records.findIndex((item) => item[key] === recordKey);
  const nextRecords =
    existingIndex >= 0
      ? records.map((item, index) => (index === existingIndex ? { ...item, ...record } : item))
      : [...records, record];

  try {
    await mkdir(databaseDir, { recursive: true });
    await writeFile(path.join(databaseDir, fileName), `${JSON.stringify(nextRecords, null, 2)}\n`);
  } catch {
    return {
      fileName,
      recordKey,
      operation: "runtime-only",
      totalRecords: nextRecords.length,
    };
  }

  return {
    fileName,
    recordKey,
    operation: existingIndex >= 0 ? "updated" : "inserted",
    totalRecords: nextRecords.length,
  };
}

async function createSquareSandboxPayment(ticketId: string, amountCents: number) {
  const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN?.trim().replace(/^Bearer\s+/i, "");
  const locationId = process.env.SQUARE_LOCATION_ID?.trim();

  if (!token || !locationId) {
    return {
      source: "Local demo fallback: Square sandbox credentials are not configured",
      payment: makeFallbackPayment(ticketId, amountCents),
    };
  }

  const response = await fetch("https://connect.squareupsandbox.com/v2/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2026-07-15",
    },
    body: JSON.stringify({
      idempotency_key: randomUUID(),
      source_id: "cnon:card-nonce-ok",
      location_id: locationId,
      amount_money: {
        amount: amountCents,
        currency: "USD",
      },
      note: `RepairOps ticket ${ticketId}`,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as { payment?: SquarePayment; errors?: Array<{ detail?: string }> };

  if (!response.ok || !body.payment) {
    const detail = body.errors?.map((error) => error.detail).filter(Boolean).join(" ");
    if (response.status === 401) {
      throw new Error(
        "Square Sandbox authorization failed. Check that SQUARE_SANDBOX_ACCESS_TOKEN is a Sandbox token and SQUARE_LOCATION_ID belongs to the same Sandbox test account.",
      );
    }
    throw new Error(detail || "Square Sandbox rejected the payment request.");
  }

  return {
    source: "Live Square Sandbox CreatePayment API",
    payment: body.payment,
  };
}

async function listAuthorizedSquareLocations() {
  const token = process.env.SQUARE_SANDBOX_ACCESS_TOKEN?.trim().replace(/^Bearer\s+/i, "");

  if (!token) {
    return { ok: false, message: "SQUARE_SANDBOX_ACCESS_TOKEN is not configured.", locations: [] };
  }

  const response = await fetch("https://connect.squareupsandbox.com/v2/locations", {
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Square-Version": "2026-07-15",
    },
  });
  const body = (await response.json().catch(() => ({}))) as {
    locations?: Array<{ id?: string; name?: string; status?: string; capabilities?: string[] }>;
    errors?: Array<{ detail?: string }>;
  };

  if (!response.ok) {
    return {
      ok: false,
      message: body.errors?.map((error) => error.detail).filter(Boolean).join(" ") || "Could not list Square locations.",
      locations: [],
    };
  }

  return {
    ok: true,
    locations:
      body.locations?.map((location) => ({
        id: location.id,
        name: location.name,
        status: location.status,
        capabilities: location.capabilities,
      })) ?? [],
  };
}

async function writeLocalDatabaseRecords(ticketId: string, payment: SquarePayment, source: string) {
  const amount = payment.amount_money.amount;
  const currency = payment.amount_money.currency;
  const receivedAt = new Date().toISOString();
  const paymentEvent = makePaymentEvent(ticketId, payment, source);
  const cleanedEvent = {
    event_id: paymentEvent.event_id,
    event_type: paymentEvent.type,
    merchant_id: paymentEvent.merchant_id,
    payment_id: payment.id,
    status: payment.status,
    amount_cents: amount,
    currency,
    ticket_id: ticketId,
    received_at: receivedAt,
  };
  const paymentRecord = {
    payment_id: payment.id,
    ticket_id: ticketId,
    square_event_id: paymentEvent.event_id,
    amount_cents: amount,
    amount_display: `${formatMoney(amount, currency)} ${currency}`,
    status: payment.status,
    source_type: payment.source_type || "CARD",
    receipt_number: payment.receipt_number || "",
    stored_at: receivedAt,
  };
  const rawEventRecord = {
    event_id: paymentEvent.event_id,
    received_at: receivedAt,
    payload: paymentEvent,
  };
  const writeResults = [
    await upsertJsonRecord("raw_square_events.json", rawEventRecord, "event_id"),
    await upsertJsonRecord("square_events_cleaned.json", cleanedEvent, "event_id"),
    await upsertJsonRecord("payments.json", paymentRecord, "payment_id"),
  ];
  const etlRun = {
    run_id: `${paymentEvent.event_id}-${Date.now()}`,
    source,
    database_path: "raw_square_events -> square_events_cleaned -> payments",
    status: "success",
    rows_written: writeResults.length,
    ran_at: receivedAt,
  };
  writeResults.push(await upsertJsonRecord("etl_runs.json", etlRun, "run_id"));

  return {
    paymentEvent,
    writeResults,
  };
}

async function writePostgresPaymentRecords(
  ticketId: string,
  payment: SquarePayment,
  paymentEvent: ReturnType<typeof makePaymentEvent>,
  source: string,
): Promise<DatabaseWriteResult[]> {
  const pool = getPool();
  if (!pool) return [];

  const amountCents = payment.amount_money.amount;
  const amountDollars = amountCents / 100;
  const currency = payment.amount_money.currency;
  const now = new Date().toISOString();
  const eventId = paymentEvent.event_id;
  const status = payment.status;
  const cleanPaymentStatus =
    status === "COMPLETED" ? "paid" : status === "APPROVED" ? "approved_not_completed" : status.toLowerCase();
  const cardBrand = payment.card_details?.card?.card_brand || null;
  const cardLast4 = payment.card_details?.card?.last_4 || null;
  const locationId = process.env.SQUARE_LOCATION_ID?.trim() || null;
  const writes: DatabaseWriteResult[] = [];
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO square_events_cleaned (
         event_id, merchant_id, event_type, event_created_at, data_type, data_id,
         payment_id, payment_created_at, payment_updated_at, payment_status,
         clean_payment_status, amount_cents, amount_dollars, currency, source_type,
         card_brand, card_last_4, location_id, order_id, risk_level, source_file
       )
       VALUES ($1, $2, $3, $4, 'payment', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NULL, 'low', $18)
       ON CONFLICT (event_id) DO UPDATE SET
         payment_status = EXCLUDED.payment_status,
         clean_payment_status = EXCLUDED.clean_payment_status,
         amount_cents = EXCLUDED.amount_cents,
         amount_dollars = EXCLUDED.amount_dollars,
         currency = EXCLUDED.currency,
         source_type = EXCLUDED.source_type,
         card_brand = EXCLUDED.card_brand,
         card_last_4 = EXCLUDED.card_last_4,
         location_id = EXCLUDED.location_id,
         source_file = EXCLUDED.source_file,
         cleaned_at = CURRENT_TIMESTAMP`,
      [
        eventId,
        paymentEvent.merchant_id,
        paymentEvent.type,
        paymentEvent.created_at,
        payment.id,
        payment.id,
        now,
        now,
        status,
        cleanPaymentStatus,
        amountCents,
        amountDollars,
        currency,
        payment.source_type || "CARD",
        cardBrand,
        cardLast4,
        locationId,
        source,
      ],
    );
    await client.query(
      `INSERT INTO payments (
         payment_id, latest_event_id, repair_ticket_id, amount_dollars, currency,
         payment_status, source_type, paid_at, last_updated_at, needs_review
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE)
       ON CONFLICT (payment_id) DO UPDATE SET
         latest_event_id = EXCLUDED.latest_event_id,
         repair_ticket_id = EXCLUDED.repair_ticket_id,
         amount_dollars = EXCLUDED.amount_dollars,
         currency = EXCLUDED.currency,
         payment_status = EXCLUDED.payment_status,
         source_type = EXCLUDED.source_type,
         paid_at = EXCLUDED.paid_at,
         last_updated_at = EXCLUDED.last_updated_at,
         needs_review = EXCLUDED.needs_review`,
      [
        payment.id,
        eventId,
        ticketId,
        amountDollars,
        currency,
        cleanPaymentStatus,
        payment.source_type || "CARD",
        status === "COMPLETED" || status === "APPROVED" ? now : null,
        now,
      ],
    );
    await client.query(
      `INSERT INTO payment_status_history (history_id, payment_id, event_id, previous_status, new_status, changed_at, note)
       VALUES ($1, $2, $3, NULL, $4, $5, $6)
       ON CONFLICT (history_id) DO UPDATE SET
         new_status = EXCLUDED.new_status,
         changed_at = EXCLUDED.changed_at,
         note = EXCLUDED.note`,
      [`HISTORY-${eventId}`, payment.id, eventId, status, now, `Payment imported from ${source}.`],
    );
    await client.query(
      `INSERT INTO repair_payment_links (
         link_id, repair_ticket_id, payment_id, link_method, confidence_level, review_required
       )
       VALUES ($1, $2, $3, 'ticket_id_note', 'high', FALSE)
       ON CONFLICT (link_id) DO UPDATE SET
         payment_id = EXCLUDED.payment_id,
         confidence_level = EXCLUDED.confidence_level,
         review_required = EXCLUDED.review_required`,
      [`LINK-${ticketId}-${payment.id}`, ticketId, payment.id],
    );
    await client.query(
      `UPDATE repair_tickets
       SET status = 'payment_confirmed',
           updated_at = CURRENT_TIMESTAMP
       WHERE repair_ticket_id = $1`,
      [ticketId],
    );
    await client.query("COMMIT");
    writes.push({ fileName: "postgres: square_events_cleaned", operation: "upserted", totalRecords: 1 });
    writes.push({ fileName: "postgres: payments", operation: "upserted", totalRecords: 1 });
    writes.push({ fileName: "postgres: payment_status_history", operation: "upserted", totalRecords: 1 });
    writes.push({ fileName: "postgres: repair_payment_links", operation: "upserted", totalRecords: 1 });
    writes.push({ fileName: "postgres: repair_tickets.status", operation: "updated", totalRecords: 1 });
    return writes;
  } catch {
    await client.query("ROLLBACK");
    return [{ fileName: "postgres payment tables", operation: "failed", totalRecords: 0 }];
  } finally {
    client.release();
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("debug") === "locations") {
    return NextResponse.json(await listAuthorizedSquareLocations());
  }

  const ticketId = url.searchParams.get("ticketId") || "R-LIVE-1001";
  const amountCents = Math.max(1, Number(url.searchParams.get("amountCents") || "100"));

  try {
    const { source, payment } = await createSquareSandboxPayment(ticketId, amountCents);
    const aiDecision = await runPaymentAgentReasoning(ticketId, amountCents, payment);
    const { paymentEvent, writeResults } = await writeLocalDatabaseRecords(ticketId, payment, source);
    const postgresWrites = await writePostgresPaymentRecords(ticketId, payment, paymentEvent, source);

    return NextResponse.json({
      source,
      aiDecision,
      rawEvent: paymentEvent,
      databaseWrites: [...writeResults, ...postgresWrites],
      cleanedPayment: {
        eventId: paymentEvent.event_id,
        eventType: paymentEvent.type,
        merchantId: paymentEvent.merchant_id,
        paymentId: payment.id,
        amountCents: payment.amount_money.amount,
        amountDisplay: `${formatMoney(payment.amount_money.amount, payment.amount_money.currency)} ${payment.amount_money.currency}`,
        status: payment.status,
        sourceType: payment.source_type || "CARD",
        receiptNumber: payment.receipt_number || "",
        cardLast4: payment.card_details?.card?.last_4 || "",
        cardBrand: payment.card_details?.card?.card_brand || "",
        receiptUrl: "receipt_url" in payment && typeof payment.receipt_url === "string" ? payment.receipt_url : "",
        ticketId,
        databasePath: "data/local-database/raw_square_events.json -> square_events_cleaned.json -> payments.json",
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Square Sandbox payment failed.",
      },
      { status: 502 },
    );
  }
}
