import { NextResponse } from "next/server";

type ChatStage = "problem" | "customer" | "phone" | "device" | "estimate" | "ready" | "agreement";

type ChatRequest = {
  ticketId: string;
  nextStage: ChatStage;
  accessCode?: string;
  draft: {
    customer?: string;
    phone?: string;
    device?: string;
    issue?: string;
    technicianNote?: string;
  };
  fallback: string;
};

function hasValidAccessCode(accessCode = "") {
  const requiredCode = process.env.DEMO_ACCESS_CODE?.trim();
  if (!requiredCode) return true;
  return accessCode.trim() === requiredCode;
}

const stageInstructions: Record<ChatStage, string> = {
  problem:
    "Ask the staff to enter only the repair problem. Tell them not to include customer name, phone number, or other private customer information in the agent chat.",
  customer: "Do not ask for customer name in chat. Say private customer information belongs in the local private info form.",
  phone: "Do not ask for phone number in chat. Say private phone information belongs in the local private info form.",
  device: "Ask what device model this repair is for only.",
  estimate:
    "Ask staff to enter the pre-repair estimate as a number. Make clear that AI does not generate the price; the staff enters it before repair starts.",
  ready:
    "Tell staff that the ticket is created and they should come back after repair or diagnostic is completed to enter the technician result: what was found, what was replaced, test result, and anything still not working.",
  agreement: "Say that the warranty agreement popup is open and the customer should review it.",
};

function extractOutputText(responseBody: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  if (responseBody.output_text) return responseBody.output_text;
  return responseBody.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("") ?? "";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { ticketId, nextStage, accessCode, draft, fallback } = (await request.json()) as ChatRequest;
  const apiKey = process.env.OPENAI_API_KEY?.replace(/\s+/g, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!hasValidAccessCode(accessCode)) {
    return NextResponse.json(
      {
        reply: "Demo access code is required before the agent can run.",
        modelMode: "Access locked",
        runtimeMs: Date.now() - startedAt,
      },
      { status: 401 },
    );
  }

  if (!apiKey) {
    return NextResponse.json({
      reply: fallback,
      modelMode: "Local safety workflow - no API key",
      runtimeMs: Date.now() - startedAt,
    });
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
              "You are RepairOps AI inside a phone repair shop dashboard. Ask exactly one short operational question for the next workflow step. Do not explain. Do not mention you are an assistant.",
          },
          {
            role: "user",
            content: JSON.stringify({
              ticketId,
              nextStage,
              knownTicketData: draft,
              stageInstruction: stageInstructions[nextStage],
              instruction:
                "Write one concise agent message that follows stageInstruction exactly. Ask only for the current stage. Do not jump ahead.",
            }),
          },
        ],
      }),
    });

    if (!response.ok) throw new Error(`OpenAI chat failed: ${response.status}`);

    const body = await response.json();
    const reply = extractOutputText(body).trim() || fallback;

    return NextResponse.json({
      reply,
      modelMode: `OpenAI chat: ${model}`,
      runtimeMs: Date.now() - startedAt,
    });
  } catch {
    return NextResponse.json({
      reply: fallback,
      modelMode: "Local safety workflow",
      runtimeMs: Date.now() - startedAt,
    });
  }
}
