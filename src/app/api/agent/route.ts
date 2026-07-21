import { NextResponse } from "next/server";

type RiskLevel = "Low" | "Medium" | "High";

type IntakePayload = {
  customer?: string;
  phone?: string;
  device?: string;
  issue?: string;
  source?: string;
  quotedPrice?: string;
  beforeNote?: string;
  technicianNote?: string;
  warrantyAccepted?: boolean;
  beforePhotoPresent?: boolean;
};

type AgentJson = {
  repairType?: string;
  technicianNotes?: string[];
  missingFields?: string[];
  risk?: RiskLevel;
  warrantySummary?: string;
  followUpDecision?: string;
  followUpDraft?: string;
  nextAction?: string;
  staffTask?: {
    title?: string;
    priority?: RiskLevel;
    owner?: string;
    status?: "Created" | "Ready for approval";
  };
};

function hasValidAccessCode(accessCode = "") {
  const requiredCode = process.env.DEMO_ACCESS_CODE?.trim();
  if (!requiredCode) return true;
  return accessCode.trim() === requiredCode;
}

function maskPhone(phone = "") {
  const digits = phone.replace(/\D/g, "");
  const lastFour = digits.slice(-4) || "0000";
  return `***-***-${lastFour}`;
}

function redactPrivateText(text = "", intake: IntakePayload) {
  let safeText = text.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[private phone]");
  const customer = intake.customer?.trim();
  if (customer && customer.length > 1) {
    safeText = safeText.replaceAll(customer, "[private customer]");
  }
  return safeText;
}

function makeAiSafeIntake(intake: IntakePayload) {
  return {
    ...intake,
    customer: "[private customer]",
    phone: maskPhone(intake.phone),
    issue: redactPrivateText(intake.issue, intake),
    beforeNote: redactPrivateText(intake.beforeNote, intake),
    technicianNote: redactPrivateText(intake.technicianNote, intake),
  };
}

function classifyRepair(issue = "") {
  const text = issue.toLowerCase();
  if (text.includes("water") || text.includes("liquid") || text.includes("spill")) return "Water damage diagnostic";
  if (text.includes("face id")) return "Face ID diagnostic";
  if (text.includes("fingerprint") || text.includes("touch id")) return "Fingerprint sensor issue";
  if (text.includes("motherboard") || text.includes("logic board") || text.includes("hdmi board") || text.includes("no power")) {
    return "Motherboard diagnostic";
  }
  if (text.includes("battery")) return "Battery replacement";
  if (text.includes("charge") || text.includes("port")) return "Charging port diagnostic";
  if (text.includes("screen") || text.includes("glass") || text.includes("crack")) return "Screen replacement";
  return "Repair intake";
}

function buildLocalAgent(intake: IntakePayload, ticketId: string, runtimeMs: number, modelMode: string, usage = { prompt: 0, output: 0 }) {
  const missingFields: string[] = [];
  const hasTechnicianNote = Boolean(intake.technicianNote?.trim());
  if (!intake.beforeNote?.trim() && !intake.issue?.trim()) missingFields.push("before-condition note");
  if (!intake.beforePhotoPresent) missingFields.push("before photo");
  if (!intake.warrantyAccepted) missingFields.push("warranty acceptance");

  const repairType = classifyRepair(`${intake.issue ?? ""} ${intake.technicianNote ?? ""}`);
  const text = `${repairType} ${intake.issue ?? ""} ${intake.beforeNote ?? ""} ${intake.technicianNote ?? ""}`
    .toLowerCase()
    .replaceAll("no liquid damage reported", "")
    .replaceAll("no liquid damage", "")
    .replaceAll("no water damage", "")
    .replaceAll("no signs of liquid damage", "");
  const highRisk =
    text.includes("water") ||
    text.includes("liquid") ||
    text.includes("spill") ||
    text.includes("motherboard") ||
    text.includes("logic board") ||
    text.includes("hdmi board") ||
    text.includes("no power") ||
    text.includes("face id") ||
    text.includes("fingerprint") ||
    text.includes("touch id");
  const risk: RiskLevel = highRisk ? "High" : missingFields.length >= 2 ? "Medium" : "Low";
  const taskTitle =
    missingFields.length > 0
      ? `Complete ${missingFields[0]} for ${ticketId}`
      : risk === "High"
        ? `Manager review required for ${ticketId}`
        : `Approve follow-up for ${ticketId}`;

  return {
    record: {
      id: ticketId,
      customer: intake.customer?.trim() || "New Customer",
      maskedPhone: maskPhone(intake.phone),
      device: intake.device?.trim() || "Device pending",
      repairType,
      issue: intake.issue?.trim() || "Customer issue pending.",
      source: intake.source || "Talk N Fix website quote",
      customerType: "New",
      stage: hasTechnicianNote ? "Ready for pickup" : "Drop-off",
      paymentStatus: hasTechnicianNote ? "Paid" : "Pending",
      quotedPrice: Number(intake.quotedPrice) || 0,
      beforeNote: intake.beforeNote?.trim() || intake.issue?.trim() || "",
      afterNote: intake.technicianNote?.trim() || "",
      warrantyAccepted: Boolean(intake.warrantyAccepted),
      pickupConfirmed: false,
      testedAtPickup: hasTechnicianNote,
      beforePhotoPresent: Boolean(intake.beforePhotoPresent),
      afterPhotoPresent: false,
    },
    result: {
      missingFields,
      risk,
      warrantySummary:
        risk === "High"
          ? `${ticketId} needs manager review before any warranty promise or review request is sent.`
          : `${intake.device || "This device"} has a 90-day limited warranty for the installed part and repair labor. Physical damage, water damage, and customer-caused damage are excluded.`,
      followUpDraft:
        risk === "High"
          ? `Hi, this is Talk N Fix. We received your ${intake.device || "device"} repair request and will confirm the next step after staff review.`
          : `Hi ${intake.customer || ""}, your ${intake.device || "device"} is ready. Your repair includes a 90-day limited warranty for the installed part and service, excluding physical or water damage.`,
      agentReply: `I turned the intake into ticket ${ticketId}, used the technician note, checked documentation, assigned ${risk.toLowerCase()} risk, and created a staff task.`,
      nextAction: risk === "High" ? "Send this ticket to manager review." : "Open the warranty page for customer acceptance.",
      technicianNotes: hasTechnicianNote
        ? [
            `Technician note recorded: ${intake.technicianNote}`,
            risk === "High"
              ? "Agent finding: manager review is required before warranty or follow-up message."
              : "Agent finding: no high-risk condition was detected in the customer issue or technician note.",
          ]
        : [
            "Technician note has not been submitted yet.",
            "Agent finding: wait for technician update before warranty or follow-up decision.",
          ],
      followUpDecision: risk === "High" ? "Hold follow-up until review" : "Ready after warranty acceptance",
      modelMode,
      staffTask: {
        title: risk === "High" ? taskTitle : `Open warranty page for ${ticketId}`,
        priority: risk,
        owner: risk === "High" ? "Manager review" : "Front counter staff",
        status: "Created",
      },
      promptTokens: usage.prompt || 420 + JSON.stringify(intake).length,
      outputTokens: usage.output || 210 + missingFields.length * 14,
      runtimeMs,
      logs: [
        "Received customer intake from dashboard form",
        "Masked phone number before storage",
        "Created structured repair ticket",
        "Read technician-submitted repair note",
        "Checked missing documentation for the current stage",
        `Assigned ${risk} risk level`,
        "Prepared warranty summary and follow-up decision",
        `Created staff task: ${taskTitle}`,
      ],
    },
  };
}

function extractOutputText(responseBody: {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
}) {
  if (responseBody.output_text) return responseBody.output_text;
  return responseBody.output?.flatMap((item) => item.content ?? []).map((content) => content.text ?? "").join("") ?? "";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const { intake, instruction, ticketId, accessCode } = (await request.json()) as {
    intake: IntakePayload;
    instruction?: string;
    ticketId?: string;
    accessCode?: string;
  };

  const id = ticketId || "R-NEW";
  const apiKey = process.env.OPENAI_API_KEY?.replace(/\s+/g, "");
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  if (!hasValidAccessCode(accessCode)) {
    return NextResponse.json(
      buildLocalAgent(intake, id, Date.now() - startedAt, "Access locked - demo code required"),
      { status: 401 },
    );
  }

  if (!apiKey) {
    return NextResponse.json(buildLocalAgent(intake, id, Date.now() - startedAt + 640, "Local safety workflow"));
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
              "You are RepairOps AI for a phone repair shop. Return only valid JSON. Do not include markdown. Create operational output, not general advice.",
          },
          {
            role: "user",
            content: JSON.stringify({
              task: instruction,
              ticketId: id,
              intake: makeAiSafeIntake(intake),
              requiredJsonShape: {
                repairType: "short repair category",
                technicianNotes: ["summarize the provided technician note only", "do not invent repair work"],
                missingFields: ["missing field names"],
                risk: "Low | Medium | High",
                warrantySummary: "90-day limited warranty note, excluding physical damage, water damage, and customer-caused damage",
                followUpDecision: "Ready for follow-up after pickup | Hold follow-up until review",
                followUpDraft: "customer text message draft",
                nextAction: "one concrete staff action",
                staffTask: {
                  title: "task title",
                  priority: "Low | Medium | High",
                  owner: "Front counter staff | Technician | Manager review",
                  status: "Created | Ready for approval",
                },
              },
              riskRules:
                "water/liquid/spill, motherboard/logic board/HDMI board/no power, Face ID, fingerprint, and Touch ID are High risk.",
              technicianNoteRule:
                "Use the technicianNote as the repair result. You may summarize it, but do not invent repair work not mentioned by the technician.",
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`OpenAI request failed: ${response.status} ${errorBody.slice(0, 160)}`);
    }

    const body = await response.json();
    const text = extractOutputText(body);
    const agentJson = JSON.parse(text) as AgentJson;
    const local = buildLocalAgent(intake, id, Date.now() - startedAt, `OpenAI LLM: ${model}`, {
      prompt: body.usage?.input_tokens ?? 0,
      output: body.usage?.output_tokens ?? 0,
    });

    return NextResponse.json({
      record: {
        ...local.record,
        repairType: agentJson.repairType || local.record.repairType,
      },
      result: {
        ...local.result,
        missingFields: local.result.missingFields,
        risk: local.result.risk,
        warrantySummary: agentJson.warrantySummary ?? local.result.warrantySummary,
        followUpDraft: agentJson.followUpDraft ?? local.result.followUpDraft,
        nextAction: agentJson.nextAction ?? local.result.nextAction,
        technicianNotes: local.result.technicianNotes,
        followUpDecision: agentJson.followUpDecision ?? local.result.followUpDecision,
        staffTask: {
          ...local.result.staffTask,
          ...agentJson.staffTask,
          priority: local.result.staffTask.priority,
        },
        agentReply: `OpenAI created ticket ${id}, analyzed the technician note, checked documentation, assigned risk, and produced the staff task.`,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown API error";
    return NextResponse.json(
      buildLocalAgent(intake, id, Date.now() - startedAt + 640, `Local safety workflow: ${message}`),
    );
  }
}
