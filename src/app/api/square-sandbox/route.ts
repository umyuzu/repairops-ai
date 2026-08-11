import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type JsonRecord = Record<string, unknown>;

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

    return NextResponse.json({
      source,
      aiDecision,
      rawEvent: paymentEvent,
      databaseWrites: writeResults,
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
