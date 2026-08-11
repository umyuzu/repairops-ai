"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import styles from "./page.module.css";

type RiskLevel = "Low" | "Medium" | "High";
type RepairStage = "Drop-off" | "Repair in progress" | "Ready for pickup" | "Picked up";
type FlowStage =
  | "idle"
  | "problem"
  | "customer"
  | "phone"
  | "device"
  | "estimate"
  | "beforeProof"
  | "ready"
  | "pickupEmail"
  | "afterProof"
  | "agreement"
  | "complete";

type RepairRecord = {
  id: string;
  customer: string;
  maskedPhone: string;
  device: string;
  repairType: string;
  issue: string;
  source: string;
  customerType: "New" | "Repeat";
  stage: RepairStage;
  paymentStatus: "Paid" | "Pending";
  quotedPrice: number;
  beforeNote: string;
  afterNote: string;
  warrantyAccepted: boolean;
  pickupConfirmed: boolean;
  testedAtPickup: boolean;
  beforePhotoPresent: boolean;
  afterPhotoPresent: boolean;
};

type IntakeForm = {
  customer: string;
  phone: string;
  device: string;
  issue: string;
  source: string;
  quotedPrice: string;
  beforeNote: string;
  technicianNote: string;
  warrantyAccepted: boolean;
  beforePhotoPresent: boolean;
};

type AgentResult = {
  missingFields: string[];
  risk: RiskLevel;
  warrantySummary: string;
  followUpDraft: string;
  agentReply: string;
  nextAction: string;
  technicianNotes: string[];
  followUpDecision: string;
  modelMode: string;
  staffTask: {
    title: string;
    priority: RiskLevel;
    owner: string;
    status: "Created";
  };
  promptTokens: number;
  outputTokens: number;
  runtimeMs: number;
  logs: string[];
};

type Message = {
  speaker: "agent" | "user";
  label: string;
  text: string;
};

type TicketStatus =
  | "Not started"
  | "Demo record"
  | "Missing docs"
  | "Waiting for technician"
  | "Warranty agreement"
  | "Complete";
type MonitorStatus = "done" | "active" | "pending";

type LiveMonitorStep = {
  label: string;
  status: MonitorStatus;
};

type AgentLoopStatus = "idle" | "active" | "done";

type AgentWorker = {
  name: string;
  domain: string;
  canDo: string;
  decision: string;
  output: string;
  status: AgentLoopStatus;
};

type AgentLoopEvent = {
  agent: string;
  inputFrom: string;
  action: string;
  decision: string;
  handoffTo: string;
  savedTo: string;
  details?: string[];
  receiptUrl?: string;
};

type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  source?: "measured" | "unavailable" | "fallback";
};

type AgentAiNotes = {
  repair: string;
  pickup: string;
  warranty: string;
  payment: string;
  review: string;
};

type AgentAiUsage = {
  repair: AgentTokenUsage;
  pickup: AgentTokenUsage;
  warranty: AgentTokenUsage;
  payment: AgentTokenUsage;
  review: AgentTokenUsage;
};

type RepairFlowState = {
  ticketId: string;
  customerLabel: string;
  customerEmail: string;
  device: string;
  issue: string;
  repairEstimate: string;
  beforePhoto: "Missing" | "Uploaded";
  afterPhoto: "Missing" | "Uploaded";
  technicianNote: string;
  squareSource: string;
  squareSourceUrl: string;
  squareEventId: string;
  squareEventType: string;
  squareMerchantId: string;
  squarePaymentId: string;
  squareAmount: string;
  squareStatus: "Waiting" | "APPROVED" | "PENDING" | "COMPLETED";
  squareSourceType: string;
  squareReceiptUrl: string;
  squareReceiptNumber: string;
  squareCardSummary: string;
  squareReceiptIssuedAt: string;
  paymentReleasedToReview: boolean;
  squareDatabaseReceipt: string;
  pickupEmail: "Not sent" | "Sent" | "Queued" | "Failed";
  pickupEmailReceipt: string;
  warrantyReceipt: string;
  reviewFollowUp: "Not sent" | "Sent" | "Queued" | "Failed";
  reviewReceipt: string;
  payment: "Not received" | "Pending" | "Paid";
  pickup: "Not picked up" | "Picked up";
  warranty: "Not signed" | "Signed";
  aiNotes: AgentAiNotes;
  aiUsage: AgentAiUsage;
};

type TicketSession = {
  id: string;
  record: RepairRecord;
  result: AgentResult;
  draft: IntakeForm;
  customerEmail: string;
  messages: Message[];
  stage: FlowStage;
  status: TicketStatus;
  agreementName: string;
  agreementAcceptedAt: string;
  warrantyPdfDataUrl: string;
};

const storageKey = "repairops-ai-ticket-sessions";
const accessStorageKey = "repairops-ai-demo-access-code";

const finalAgentTeam: AgentWorker[] = [
  {
    name: "Repair Workflow Agent",
    domain: "Drop-off and repair proof",
    canDo: "Check ticket, before photo, repair note, and after photo",
    decision: "Waiting",
    output: "No drop-off or repair proof has been checked yet.",
    status: "idle",
  },
  {
    name: "Pickup Email Agent",
    domain: "Customer pickup email",
    canDo: "Send the pickup-ready email after the repair ticket and before photo are ready",
    decision: "Waiting",
    output: "No pickup email has been sent yet.",
    status: "idle",
  },
  {
    name: "Warranty Agent",
    domain: "After photo and pickup signature",
    canDo: "Require after photo, then capture the customer's pickup and working-condition acceptance",
    decision: "Waiting",
    output: "No warranty acceptance has been captured yet.",
    status: "idle",
  },
  {
    name: "Square Payment Agent",
    domain: "Square payment event",
    canDo: "Read Square payment after warranty acceptance and compare amount",
    decision: "Waiting",
    output: "No Square payment event has been checked yet.",
    status: "idle",
  },
  {
    name: "Review Follow-up Agent",
    domain: "Post-payment review email",
    canDo: "Send the thank-you and review request after pickup, warranty, and payment",
    decision: "Waiting",
    output: "No review follow-up has been sent yet.",
    status: "idle",
  },
];

const initialRepairFlow: RepairFlowState = {
  ticketId: "R-LIVE-1001",
  customerLabel: "Walk-in customer",
  customerEmail: "",
  device: "iPhone 13 Pro",
  issue: "Cracked screen after drop",
  repairEstimate: "$1.00 USD",
  beforePhoto: "Missing",
  afterPhoto: "Missing",
  technicianNote: "Waiting for repair result.",
  squareSource: "Square API Reference: payment.created webhook",
  squareSourceUrl: "https://developer.squareup.com/reference/square/webhooks/payment.created",
  squareEventId: "Not received",
  squareEventType: "Waiting",
  squareMerchantId: "6SSW7HV8K2ST5",
  squarePaymentId: "Not received",
  squareAmount: "$0.00 USD",
  squareStatus: "Waiting",
  squareSourceType: "CARD",
  squareReceiptUrl: "",
  squareReceiptNumber: "Not received",
  squareCardSummary: "Not received",
  squareReceiptIssuedAt: "",
  paymentReleasedToReview: false,
  squareDatabaseReceipt: "No Square event stored yet.",
  pickupEmail: "Not sent",
  pickupEmailReceipt: "No pickup email stored yet.",
  warrantyReceipt: "No warranty acceptance stored yet.",
  reviewFollowUp: "Not sent",
  reviewReceipt: "No review request stored yet.",
  payment: "Not received",
  pickup: "Not picked up",
  warranty: "Not signed",
  aiNotes: {
    repair: "Waiting for Repair Workflow Agent AI reasoning.",
    pickup: "Waiting for Pickup Email Agent AI reasoning.",
    warranty: "Waiting for Warranty Agent AI reasoning.",
    payment: "Waiting for Square Payment Agent AI reasoning.",
    review: "Waiting for Review Follow-up Agent AI reasoning.",
  },
  aiUsage: {
    repair: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    pickup: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    warranty: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    payment: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    review: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
  },
};

const squareOfficialPaymentEvent = {
  squareEventId: "13b867cf-db3d-4b1c-90b6-2f32a9d78124",
  squareEventType: "payment.created",
  squarePaymentId: "hYy9pRFVxpDsO1FB05SunFWUe9JZY",
  squareAmount: "$1.00 USD",
  squareStatus: "APPROVED" as const,
  payment: "Paid" as const,
};

function formatAgentUsage(usage: AgentTokenUsage) {
  if (usage.source === "fallback") return "OpenAI tokens: 0 - fallback path used";
  if (usage.source === "unavailable") return "OpenAI tokens: usage not returned by API";
  const approximateCost = usage.inputTokens * 0.00000015 + usage.outputTokens * 0.0000006;
  return `OpenAI tokens: ${usage.inputTokens} input / ${usage.outputTokens} output / ${usage.totalTokens} total · cost ≈ $${approximateCost.toExponential(2)}`;
}

const emptyIntake: IntakeForm = {
  customer: "",
  phone: "",
  device: "",
  issue: "",
  source: "Talk N Fix website quote",
  quotedPrice: "",
  beforeNote: "",
  technicianNote: "",
  warrantyAccepted: true,
  beforePhotoPresent: false,
};

const requiredFields: Record<RepairStage, Array<[string, (record: RepairRecord) => boolean]>> = {
  "Drop-off": [
    ["before-condition note", (record) => Boolean(record.beforeNote)],
    ["before photo", (record) => record.beforePhotoPresent],
    ["warranty acceptance", (record) => record.warrantyAccepted],
  ],
  "Repair in progress": [
    ["before-condition note", (record) => Boolean(record.beforeNote)],
    ["before photo", (record) => record.beforePhotoPresent],
  ],
  "Ready for pickup": [
    ["technician repair note", (record) => Boolean(record.afterNote)],
    ["after photo", (record) => record.afterPhotoPresent],
    ["pickup testing confirmation", (record) => record.testedAtPickup],
  ],
  "Picked up": [
    ["pickup confirmation", (record) => record.pickupConfirmed],
  ],
};

function cleanRiskText(text: string) {
  return text
    .toLowerCase()
    .replaceAll("no liquid damage reported", "")
    .replaceAll("no liquid damage", "")
    .replaceAll("no water damage", "")
    .replaceAll("no signs of liquid damage", "")
    .replaceAll("not water damaged", "");
}

function classifyRepair(text: string) {
  const issue = cleanRiskText(text);
  if (issue.includes("water") || issue.includes("liquid") || issue.includes("spill")) return "Water damage diagnostic";
  if (issue.includes("face id")) return "Face ID diagnostic";
  if (issue.includes("fingerprint") || issue.includes("touch id")) return "Fingerprint sensor issue";
  if (issue.includes("motherboard") || issue.includes("logic board") || issue.includes("hdmi board") || issue.includes("no power")) {
    return "Motherboard diagnostic";
  }
  if (issue.includes("battery")) return "Battery replacement";
  if (issue.includes("charge") || issue.includes("port")) return "Charging port diagnostic";
  if (issue.includes("screen") || issue.includes("glass") || issue.includes("crack")) return "Screen replacement";
  return "Repair intake";
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return `***-***-${digits.slice(-4) || "0000"}`;
}

function cleanPdfText(value: string) {
  return value.replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function wrapPdfLine(value: string, maxLength = 84) {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxLength) {
      if (line) lines.push(line);
      line = word;
    } else {
      line = next;
    }
  });

  if (line) lines.push(line);
  return lines;
}

function makeWarrantyPdfDataUrl(record: RepairRecord, result: AgentResult, customerName: string, acceptedAt: string) {
  const bodyLines = [
    "Talk N Fix Limited Warranty Acceptance",
    "",
    `Ticket: ${record.id}`,
    `Customer: ${customerName}`,
    `Device: ${record.device}`,
    `Repair: ${record.repairType}`,
    `Staff estimate: ${record.quotedPrice > 0 ? `$${record.quotedPrice}` : "Estimate pending"}`,
    `Accepted at: ${acceptedAt}`,
    "",
    result.warrantySummary,
    "",
    "Customer confirmation:",
    "I confirm that I received my repaired device in working condition, reviewed the repair result, and accepted the device at pickup.",
    "",
    "Warranty excludes physical damage, water damage, and customer-caused damage after pickup.",
    "",
    `Typed acceptance name: ${customerName}`,
  ].flatMap((line) => (line ? wrapPdfLine(line) : [""]));

  const stream = [
    "BT",
    "/F1 16 Tf",
    "50 760 Td",
    ...bodyLines.map((line, index) => {
      const font = index === 0 ? "/F1 16 Tf " : "/F1 10 Tf ";
      return `${index === 0 ? font : ""}(${cleanPdfText(line)}) Tj 0 -18 Td`;
    }),
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return `data:application/pdf;base64,${window.btoa(pdf)}`;
}

function downloadPdf(dataUrl: string, fileName: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function redactPrivateText(text: string, draft: IntakeForm) {
  let safeText = text.replace(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g, "[private phone]");
  const customer = draft.customer.trim();
  if (customer.length > 1) {
    safeText = safeText.replaceAll(customer, "[private customer]");
  }
  return safeText;
}

function makeAiSafeDraft(draft: IntakeForm) {
  return {
    ...draft,
    customer: "[private customer]",
    phone: maskPhone(draft.phone),
    issue: redactPrivateText(draft.issue, draft),
    beforeNote: redactPrivateText(draft.beforeNote, draft),
    technicianNote: redactPrivateText(draft.technicianNote, draft),
  };
}

function makeRecord(draft: IntakeForm, id: string): RepairRecord {
  const repairType = classifyRepair(`${draft.issue} ${draft.technicianNote}`);

  return {
    id,
    customer: draft.customer || "New Customer",
    maskedPhone: maskPhone(draft.phone),
    device: draft.device || "Device not entered yet",
    repairType,
    issue: draft.issue || "Customer issue pending.",
    source: draft.source,
    customerType: "New",
    stage: draft.technicianNote ? "Ready for pickup" : "Drop-off",
    paymentStatus: draft.technicianNote ? "Paid" : "Pending",
    quotedPrice: Number(draft.quotedPrice) || 0,
    beforeNote: draft.issue,
    afterNote: draft.technicianNote,
    warrantyAccepted: draft.warrantyAccepted,
    pickupConfirmed: false,
    testedAtPickup: Boolean(draft.technicianNote),
    beforePhotoPresent: draft.beforePhotoPresent,
    afterPhotoPresent: false,
  };
}

function localAgent(record: RepairRecord, modelMode = "OpenAI LLM pending"): AgentResult {
  const missingFields = requiredFields[record.stage]
    .filter(([, isPresent]) => !isPresent(record))
    .map(([field]) => field);
  const riskText = cleanRiskText(`${record.repairType} ${record.issue} ${record.beforeNote} ${record.afterNote}`);
  const highRisk =
    riskText.includes("water") ||
    riskText.includes("liquid") ||
    riskText.includes("spill") ||
    riskText.includes("motherboard") ||
    riskText.includes("logic board") ||
    riskText.includes("hdmi board") ||
    riskText.includes("no power") ||
    riskText.includes("face id") ||
    riskText.includes("fingerprint") ||
    riskText.includes("touch id");
  const risk: RiskLevel = highRisk ? "High" : missingFields.length >= 2 ? "Medium" : "Low";
  const taskTitle = `Prepare pickup warranty for ${record.id}`;

  return {
    missingFields,
    risk,
    warrantySummary: `${record.device} repair has a 90-day limited warranty for the installed part and repair labor. Physical damage, water damage, and customer-caused damage are excluded.`,
    followUpDraft: `Hi ${record.customer}, your ${record.device} is ready. Your repair includes a 90-day limited warranty for the installed part and service, excluding physical or water damage.`,
    agentReply: `I created ${record.id}, analyzed the repair readiness note, assigned ${risk.toLowerCase()} risk, drafted warranty language, and prepared the next workflow step.`,
    nextAction: "Ask the customer to review the warranty terms and confirm pickup condition.",
    technicianNotes: record.afterNote
      ? [
          `Technician submitted: ${record.afterNote}`,
          "Agent finding: warranty text is ready after after-photo proof and customer pickup confirmation.",
        ]
      : ["Waiting for technician repair-ready note."],
    followUpDecision: "Ready after customer warranty agreement",
    modelMode,
    staffTask: {
      title: taskTitle,
      priority: risk,
      owner: "Front counter staff",
      status: "Created",
    },
    promptTokens: 520 + record.issue.length + record.afterNote.length,
    outputTokens: 230 + missingFields.length * 12,
    runtimeMs: 720 + missingFields.length * 80,
    logs: [
      "Collected customer problem through agent chat",
      "Masked customer phone number",
      "Created repair ticket",
      record.afterNote ? "Read repair-ready note" : "Waiting for technician repair-ready note",
      `Assigned ${risk} risk level`,
      "Drafted 90-day limited warranty text",
      `Prepared workflow step: ${taskTitle}`,
    ],
  };
}

function statusFor(record: RepairRecord, result: AgentResult): TicketStatus {
  if (result.missingFields.length > 0) return "Missing docs";
  if (!record.afterNote) return "Waiting for technician";
  return "Warranty agreement";
}

function documentationChecklist(session: TicketSession, flow: RepairFlowState) {
  const stage = session.stage;
  const needsAfterPhoto = ["afterProof", "agreement", "complete"].includes(stage) || Boolean(session.record.afterNote);
  const needsWarranty = ["agreement", "complete"].includes(stage) || flow.afterPhoto === "Uploaded";
  const needsPayment = stage === "complete" || flow.warranty === "Signed";

  return [
    {
      label: "Before photo proof",
      done: flow.beforePhoto === "Uploaded" || session.record.beforePhotoPresent,
      needed: stage !== "idle",
    },
    {
      label: "Technician repair note",
      done: Boolean(session.record.afterNote) || flow.technicianNote !== "Waiting for repair result.",
      needed: ["ready", "pickupEmail", "afterProof", "agreement", "complete"].includes(stage),
    },
    {
      label: "Pickup email event",
      done: flow.pickupEmail === "Sent" || flow.pickupEmail === "Queued",
      needed: ["pickupEmail", "afterProof", "agreement", "complete"].includes(stage),
    },
    {
      label: "After photo proof",
      done: flow.afterPhoto === "Uploaded" || session.record.afterPhotoPresent,
      needed: needsAfterPhoto,
    },
    {
      label: "Warranty acceptance",
      done: flow.warranty === "Signed" || Boolean(session.agreementAcceptedAt),
      needed: needsWarranty,
    },
    {
      label: "Square payment receipt",
      done: flow.payment === "Paid" && flow.squareReceiptNumber !== "Not received",
      needed: needsPayment,
    },
  ].filter((item) => item.needed);
}

function queueStateFor(session: TicketSession) {
  if (session.status === "Not started") {
    return { agent: "Start", detail: "Open a repair ticket" };
  }
  if (session.status === "Complete" || session.stage === "complete") {
    return { agent: "Done", detail: "Case completed" };
  }
  if (session.stage === "agreement" || session.status === "Warranty agreement") {
    return { agent: "Warranty Agent", detail: "Customer signature needed" };
  }
  if (session.stage === "ready") {
    return { agent: "Repair Agent", detail: "Technician result needed" };
  }
  if (session.stage === "pickupEmail") {
    return { agent: "Pickup Email Agent", detail: "Ready email needed" };
  }
  if (session.stage === "afterProof") {
    return { agent: "Warranty Agent", detail: "After proof needed" };
  }
  if (session.stage !== "idle") {
    return { agent: "Repair Agent", detail: "Intake in progress" };
  }
  if (session.result.missingFields.length > 0) {
    return { agent: "Repair Agent", detail: `${session.result.missingFields.length} document item needed` };
  }
  if (!session.record.afterNote) {
    return { agent: "Repair Agent", detail: "Waiting for repair note" };
  }
  return { agent: "Pickup Agent", detail: "Ready for customer contact" };
}

function makeBlankSession(): TicketSession {
  const record: RepairRecord = {
    id: "",
    customer: "New customer",
    maskedPhone: "***-***-0000",
    device: "New repair ticket",
    repairType: "Repair intake",
    issue: "Start from the private customer info panel.",
    source: "Not started",
    customerType: "New",
    stage: "Drop-off",
    paymentStatus: "Pending",
    quotedPrice: 0,
    beforeNote: "",
    afterNote: "",
    warrantyAccepted: false,
    pickupConfirmed: false,
    testedAtPickup: false,
    beforePhotoPresent: false,
    afterPhotoPresent: false,
  };

  return {
    id: "",
    record,
    result: {
      ...localAgent(record),
      missingFields: [],
      risk: "Low",
      warrantySummary: "No active repair ticket yet.",
      followUpDraft: "Create a repair ticket to begin the customer workflow.",
      agentReply: "Waiting for the first repair ticket.",
      nextAction: "Enter private customer information, then create a new repair ticket.",
      technicianNotes: ["No repair note has been submitted yet."],
      followUpDecision: "Waiting",
      logs: ["Waiting for a new repair ticket."],
      staffTask: {
        title: "No active repair ticket",
        priority: "Low",
        owner: "Front counter staff",
        status: "Created",
      },
    },
    draft: { ...emptyIntake },
    messages: [
      {
        speaker: "agent",
        label: "RepairOps team",
        text: "Enter customer information, then create a new repair ticket to start the agent workflow.",
      },
    ],
    stage: "idle",
    status: "Not started",
    customerEmail: "",
    agreementName: "",
    agreementAcceptedAt: "",
    warrantyPdfDataUrl: "",
  };
}

function loadSavedSessions() {
  if (typeof window === "undefined") return [];

  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return [];
    const parsed = JSON.parse(saved) as TicketSession[];
    if (!Array.isArray(parsed) || parsed.length === 0) return [];

    return parsed.map((session) => ({
      ...session,
      customerEmail: session.customerEmail ?? "",
      agreementAcceptedAt: session.agreementAcceptedAt ?? "",
      warrantyPdfDataUrl: session.warrantyPdfDataUrl ?? "",
      result: session.result,
    }));
  } catch {
    return [];
  }
}

function flowFromSession(session: TicketSession): RepairFlowState {
  const isComplete = session.stage === "complete" || session.status === "Complete";
  const hasBeforeProof = session.record.beforePhotoPresent || ["ready", "pickupEmail", "afterProof", "agreement", "complete"].includes(session.stage);
  const hasTechnicianNote = Boolean(session.record.afterNote) || ["pickupEmail", "afterProof", "agreement", "complete"].includes(session.stage);
  const hasPickupEmail = ["afterProof", "agreement", "complete"].includes(session.stage);
  const hasAfterProof = session.record.afterPhotoPresent || ["agreement", "complete"].includes(session.stage);
  const hasWarranty = Boolean(session.agreementAcceptedAt) || isComplete;

  return {
    ...initialRepairFlow,
    ticketId: session.id,
    customerLabel: session.record.customer || initialRepairFlow.customerLabel,
    customerEmail: session.customerEmail || initialRepairFlow.customerEmail,
    device: session.record.device === "Device not entered yet" ? initialRepairFlow.device : session.record.device,
    issue: session.record.issue || initialRepairFlow.issue,
    repairEstimate: session.record.quotedPrice > 0 ? `$${session.record.quotedPrice}.00 USD` : initialRepairFlow.repairEstimate,
    beforePhoto: hasBeforeProof ? "Uploaded" : "Missing",
    afterPhoto: hasAfterProof ? "Uploaded" : "Missing",
    technicianNote: hasTechnicianNote ? session.record.afterNote || "Technician result recorded." : "Waiting for repair result.",
    pickupEmail: hasPickupEmail ? "Queued" : "Not sent",
    pickupEmailReceipt: hasPickupEmail ? "Pickup email processed for this ticket." : "No pickup email stored yet.",
    pickup: hasWarranty ? "Picked up" : "Not picked up",
    warranty: hasWarranty ? "Signed" : "Not signed",
    warrantyReceipt: hasWarranty ? "Warranty acceptance saved for this ticket." : "No warranty acceptance stored yet.",
    payment: isComplete ? "Paid" : "Not received",
    squareStatus: isComplete ? "APPROVED" : "Waiting",
    squareEventType: isComplete ? "payment.created" : "Waiting",
    squareEventId: isComplete ? squareOfficialPaymentEvent.squareEventId : "Not received",
    squarePaymentId: isComplete ? squareOfficialPaymentEvent.squarePaymentId : "Not received",
    squareAmount: isComplete
      ? session.record.quotedPrice > 0
        ? `$${session.record.quotedPrice}.00 USD`
        : squareOfficialPaymentEvent.squareAmount
      : "$0.00 USD",
    squareDatabaseReceipt: isComplete ? "Payment event processed for this ticket." : "No Square event stored yet.",
    paymentReleasedToReview: isComplete,
    reviewFollowUp: isComplete ? "Queued" : "Not sent",
    reviewReceipt: isComplete ? "Review follow-up processed for this ticket." : "No review request stored yet.",
  };
}

function placeholder(stage: FlowStage) {
  if (stage === "problem") return "Screen is broken. No customer name or phone here.";
  if (stage === "customer") return "Customer name";
  if (stage === "phone") return "856-555-1842";
  if (stage === "device") return "iPhone 13 Pro";
  if (stage === "estimate") return "189";
  if (stage === "beforeProof") return "Use Record before proof in the agent workflow before repair starts.";
  if (stage === "ready") return "Repair/diagnostic completed: screen replaced, display and touch tested, device is working at pickup.";
  if (stage === "pickupEmail") return "Use Send pickup email in the agent workflow.";
  if (stage === "afterProof") return "Use Record after proof in the agent workflow before warranty signature.";
  return "";
}

function parseInitialMessage(value: string) {
  const knownDevices: Array<{ name: string; patterns: RegExp[] }> = [
    { name: "iPhone 15 Pro", patterns: [/iphone\s*15\s*pro/i] },
    { name: "iPhone 14 Pro", patterns: [/iphone\s*14\s*pro/i] },
    { name: "iPhone 13 Pro", patterns: [/iphone\s*13\s*pro/i] },
    { name: "iPhone 13", patterns: [/iphone\s*13/i] },
    { name: "iPhone 12", patterns: [/iphone\s*12/i] },
    { name: "Samsung Galaxy S23", patterns: [/samsung\s*(galaxy\s*)?s23/i, /\bgalaxy\s*s23\b/i, /\bs23\b/i] },
    { name: "Google Pixel 7", patterns: [/google\s*pixel\s*7/i, /\bpixel\s*7\b/i] },
    { name: "iPad Air", patterns: [/ipad\s*air/i] },
    { name: "MacBook Air", patterns: [/macbook\s*air/i] },
  ];
  const samsungMatch = value.match(/(?:samsung\s*)?(?:galaxy\s*)?s\s*(\d{2})(?:\s*(ultra|plus|\+))?/i);
  const detectedDevice = knownDevices.find((item) => item.patterns.some((pattern) => pattern.test(value)))?.name;
  const device =
    detectedDevice ??
    (samsungMatch
      ? `Samsung Galaxy S${samsungMatch[1]}${samsungMatch[2] ? ` ${samsungMatch[2].replace("+", "Plus")}` : ""}`
      : "");
  return {
    customer: "",
    phone: "",
    device,
  };
}

function moneyTextToCents(value: string) {
  const amount = Number(value.replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return 100;
  return Math.round(amount * 100);
}

async function getOpenAiChatReply(
  ticketId: string,
  nextStage: FlowStage,
  draft: IntakeForm,
  fallback: string,
  accessCode: string,
) {
  if (nextStage === "idle" || nextStage === "complete") {
    return { reply: fallback, modelMode: "OpenAI LLM pending" };
  }

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId, nextStage, accessCode, draft: makeAiSafeDraft(draft), fallback }),
    });
    return (await response.json()) as { reply: string; modelMode: string; runtimeMs: number };
  } catch {
    return { reply: fallback, modelMode: "Local safety workflow" };
  }
}

export default function Home() {
  const [sessions, setSessions] = useState<TicketSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [answer, setAnswer] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [hasLoadedSavedTickets, setHasLoadedSavedTickets] = useState(false);
  const [privateCustomer, setPrivateCustomer] = useState("");
  const [privatePhone, setPrivatePhone] = useState("");
  const [privateEmail, setPrivateEmail] = useState("");
  const [isMonitorOpen, setIsMonitorOpen] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [accessInput, setAccessInput] = useState("");
  const [accessError, setAccessError] = useState("");
  const [isAccessUnlocked, setIsAccessUnlocked] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [repairFlow, setRepairFlow] = useState<RepairFlowState>(initialRepairFlow);
  const [isSquareIngesting, setIsSquareIngesting] = useState(false);
  const [isWorkflowWriting, setIsWorkflowWriting] = useState(false);
  const [agentWorkers, setAgentWorkers] = useState<AgentWorker[]>(finalAgentTeam);
  const [agentLoopEvents, setAgentLoopEvents] = useState<AgentLoopEvent[]>([]);
  const [liveMonitorSteps, setLiveMonitorSteps] = useState<LiveMonitorStep[]>([
    { label: "Waiting for staff action", status: "active" },
    { label: "Private customer fields stay local", status: "pending" },
    { label: "Agent output will appear after each workflow step", status: "pending" },
  ]);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const monitorRunRef = useRef(0);
  const blankSession = useMemo(() => makeBlankSession(), []);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? blankSession,
    [blankSession, selectedId, sessions],
  );
  const record = selected.record;
  const result = selected.result;
  const documentChecklist = documentationChecklist(selected, repairFlow);
  const missingDocuments = documentChecklist.filter((item) => !item.done);
  const approximateCost = ((result.promptTokens + result.outputTokens) * 0.0000006).toFixed(4);
  const activeAgentIndex = Math.max(
    0,
    agentWorkers.findIndex((agent) => agent.status === "active") >= 0
      ? agentWorkers.findIndex((agent) => agent.status === "active")
      : agentWorkers.findIndex((agent) => agent.status !== "done") >= 0
        ? agentWorkers.findIndex((agent) => agent.status !== "done")
        : agentWorkers.length - 1,
  );
  const activeAgent = agentWorkers[activeAgentIndex];
  const workflowTicketId = selected.id || repairFlow.ticketId;

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedSessions = loadSavedSessions();
      const savedAccessCode = window.localStorage.getItem(accessStorageKey) ?? "";
      setSessions(savedSessions);
      setSelectedId("");
      setAccessCode(savedAccessCode);
      setAccessInput(savedAccessCode);
      setIsAccessUnlocked(Boolean(savedAccessCode));
      setHasLoadedSavedTickets(true);

      if (!savedAccessCode) {
        void fetch("/api/access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessCode: "" }),
        }).then((response) => {
          if (response.ok) setIsAccessUnlocked(true);
        });
      }
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!hasLoadedSavedTickets) return;
    window.localStorage.setItem(storageKey, JSON.stringify(sessions));
  }, [hasLoadedSavedTickets, sessions]);

  useEffect(() => {
    const chatBox = chatBoxRef.current;
    if (!chatBox) return;
    chatBox.scrollTop = chatBox.scrollHeight;
  }, [selected.messages, isRunning, selectedId]);

  const updateSelected = (changes: Partial<TicketSession>) => {
    setSessions((current) =>
      current.map((session) => (session.id === selected.id ? { ...session, ...changes } : session)),
    );
  };

  const beginLiveMonitor = (labels: string[]) => {
    const runId = monitorRunRef.current + 1;
    monitorRunRef.current = runId;
    setLiveMonitorSteps(labels.map((label, index) => ({ label, status: index === 0 ? "active" : "pending" })));
    labels.forEach((_, index) => {
      window.setTimeout(() => {
        if (monitorRunRef.current !== runId) return;
        setLiveMonitorSteps((current) =>
          current.map((step, stepIndex) => ({
            ...step,
            status: stepIndex < index ? "done" : stepIndex === index ? "active" : "pending",
          })),
        );
      }, index * 650);
    });
  };

  const finishLiveMonitor = (extraLabel?: string) => {
    monitorRunRef.current += 1;
    setLiveMonitorSteps((current) => {
      const completed = current.map((step) => ({ ...step, status: "done" as const }));
      return extraLabel ? [...completed, { label: extraLabel, status: "done" }] : completed;
    });
  };

  const handleAnswerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void submitAnswer();
  };

  const submitAccessCode = async () => {
    const value = accessInput.trim();

    setIsCheckingAccess(true);
    setAccessError("");

    try {
      const response = await fetch("/api/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: value }),
      });

      if (!response.ok) {
        setAccessError("Invalid access code.");
        return;
      }

      if (value) window.localStorage.setItem(accessStorageKey, value);
      setAccessCode(value);
      setIsAccessUnlocked(true);
    } catch {
      setAccessError("Access check failed. Try again.");
    } finally {
      setIsCheckingAccess(false);
    }
  };

  const handleAccessKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    void submitAccessCode();
  };

  const createNewTicket = async () => {
    const existingNumbers = sessions
      .map((session) => Number(session.id.slice(2)))
      .filter((number) => Number.isFinite(number));
    const nextNumber = Math.max(1050, ...existingNumbers) + 1;
    const id = `R-${nextNumber}`;
    const draft = {
      ...emptyIntake,
      customer: privateCustomer.trim(),
      phone: privatePhone.trim(),
    };
    const recordDraft = makeRecord(draft, id);
    const session: TicketSession = {
      id,
      record: recordDraft,
      result: localAgent(recordDraft),
      draft,
      customerEmail: privateEmail.trim(),
      stage: "problem",
      status: "Waiting for technician",
      agreementName: "",
      agreementAcceptedAt: "",
      warrantyPdfDataUrl: "",
      messages: [
        {
          speaker: "agent",
          label: "Repair Ticket Agent",
          text: "Connecting to OpenAI chat...",
        },
      ],
    };
    setSessions((current) => [session, ...current]);
    setSelectedId(id);
    setAnswer("");
    const startingFlow = {
      ...initialRepairFlow,
      ticketId: id,
      customerLabel: draft.customer || initialRepairFlow.customerLabel,
      customerEmail: privateEmail.trim() || initialRepairFlow.customerEmail,
      device: "Device not entered yet",
      issue: "Customer issue pending.",
      repairEstimate: "$0.00 USD",
      beforePhoto: "Missing" as const,
      afterPhoto: "Missing" as const,
      technicianNote: "Waiting for repair result.",
    };
    setRepairFlow(startingFlow);
    applyAgentProgress(startingFlow);
    setPrivateCustomer("");
    setPrivatePhone("");
    setPrivateEmail("");
    setIsRunning(true);
    beginLiveMonitor([
      "Created local ticket shell",
      "Stored customer name and phone in browser only",
      "Redacted private fields before OpenAI request",
      "Asked OpenAI for the next repair-intake question",
    ]);

    const chat = await getOpenAiChatReply(
      id,
      "problem",
      draft,
      "Start with the repair problem only. Do not include customer name or phone number.",
      accessCode,
    );

    setSessions((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              result: { ...item.result, modelMode: chat.modelMode },
              messages: [{ speaker: "agent", label: chat.modelMode, text: chat.reply }],
            }
          : item,
      ),
    );
    setIsRunning(false);
    finishLiveMonitor("OpenAI returned the next non-PII intake step");
  };

  const continueSelectedTicket = () => {
    const draft: IntakeForm = {
      ...emptyIntake,
      customer: record.customer,
      device: record.device === "Device not entered yet" ? "" : record.device,
      issue: record.issue === "Customer issue pending." ? "" : record.issue,
      source: record.source,
      quotedPrice: record.quotedPrice ? String(record.quotedPrice) : "",
      beforeNote: record.beforeNote,
      technicianNote: record.afterNote,
      warrantyAccepted: record.warrantyAccepted,
      beforePhotoPresent: record.beforePhotoPresent,
    };

    if (!draft.issue) {
      updateSelected({
        draft,
        stage: "problem",
        messages: [
          ...selected.messages,
          {
            speaker: "agent",
            label: "Repair Ticket Agent",
            text: "Let's continue this ticket. What problem did the customer report?",
          },
        ],
      });
      return;
    }

    updateSelected({
      draft,
      stage: record.afterNote ? "agreement" : record.quotedPrice > 0 ? "ready" : "estimate",
      status: record.afterNote ? statusFor(record, result) : "Waiting for technician",
      messages: [
        ...selected.messages,
        {
          speaker: "agent",
          label: "Repair Ticket Agent",
          text: record.afterNote
            ? "This ticket already has a repair note. Ask the customer to type their warranty agreement."
            : record.quotedPrice > 0
              ? "Ticket is created. Come back here after repair or diagnostic is completed, then enter the technician result."
              : "Ticket is created. Enter the staff estimate before repair starts.",
        },
      ],
    });
  };

  const deleteTicket = (id: string) => {
    const nextSessions = sessions.filter((session) => session.id !== id);
    setSessions(nextSessions);
    if (id === selectedId) {
      setSelectedId(nextSessions[0]?.id ?? "");
      setAnswer("");
    }
  };

  const clearSavedTickets = () => {
    window.localStorage.removeItem(storageKey);
    setSessions([]);
    setSelectedId("");
    setAnswer("");
  };

  const finalizeWithAgent = async (draft: IntakeForm) => {
    setIsRunning(true);
    const localRecord = makeRecord(draft, selected.id);
    beginLiveMonitor([
      "Received technician repair result",
      "Redacted private customer data before LLM call",
      "Sent repair-only payload to OpenAI",
      "Classified risk and documentation gaps",
      "Drafted warranty summary and staff task",
    ]);

    try {
      const response = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intake: draft,
          instruction:
            "Create the repair ticket, generate concise repair-ready notes from the technician input, classify risk, draft 90-day limited warranty language, and create the next staff task.",
          ticketId: selected.id,
          accessCode,
        }),
      });
      const data = (await response.json()) as { record?: RepairRecord; result?: AgentResult };
      const nextRecord = data.record ?? localRecord;
      const nextResult = data.result ?? localAgent(nextRecord);
      updateSelected({
        record: nextRecord,
        result: nextResult,
        stage: "pickupEmail",
        status: "Waiting for technician",
        messages: [
          ...selected.messages,
          {
            speaker: "agent",
            label: nextResult.modelMode,
            text: `${nextRecord.id} technician notes are analyzed. I drafted the warranty language, but first the Pickup Email Agent must notify the customer that the device is ready.`,
          },
          {
            speaker: "agent",
            label: "Pickup Email Agent",
            text: "Next required action: send the ready-for-pickup email from the Agent workflow.",
          },
        ],
      });
      finishLiveMonitor("Agent output saved to the selected ticket");
    } catch {
      const nextResult = localAgent(localRecord, "Local safety workflow");
      updateSelected({
        record: localRecord,
        result: nextResult,
        stage: "pickupEmail",
        status: "Waiting for technician",
        messages: [
          ...selected.messages,
          {
            speaker: "agent",
            label: "Local safety workflow",
            text: `${localRecord.id} technician notes are analyzed locally. Send the pickup email before moving to after proof and warranty.`,
          },
        ],
      });
      finishLiveMonitor("Local safety output saved after API issue");
    } finally {
      setIsRunning(false);
    }
  };

  const submitAnswer = async () => {
    const value = answer.trim();
    if (!value || isRunning || selected.stage === "idle" || selected.stage === "complete") return;
    const draft = { ...selected.draft };
    const nextMessages = [...selected.messages, { speaker: "user" as const, label: "You", text: value }];
    setAnswer("");

    if (selected.stage === "problem") {
      draft.issue = value;
      draft.device = "";
      const previewRecord = makeRecord(draft, selected.id);
      const previewResult = localAgent(previewRecord, result.modelMode);
      const nextStage: FlowStage = "device";
      const question = "What device model is this repair for? Do not include customer name or phone.";
      updateSelected({
        draft,
        record: previewRecord,
        result: previewResult,
        status: "Waiting for technician",
        messages: [
          ...nextMessages,
          { speaker: "agent", label: "Repair Ticket Agent", text: "OpenAI is preparing the next intake question..." },
        ],
        stage: nextStage,
      });
      setRepairFlow((current) => {
        const nextFlow = { ...current, ticketId: selected.id, issue: draft.issue };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      setIsRunning(true);
      beginLiveMonitor([
        "Read repair problem from chat",
        "Prepared device model question",
        "Kept customer name and phone out of OpenAI",
        "Requested next workflow question",
      ]);
      const chat = await getOpenAiChatReply(selected.id, nextStage, draft, question, accessCode);
      setSessions((current) =>
        current.map((session) =>
          session.id === selected.id
            ? {
                ...session,
                result: { ...session.result, modelMode: chat.modelMode },
                messages: [...nextMessages, { speaker: "agent", label: chat.modelMode, text: chat.reply }],
              }
            : session,
        ),
      );
      setIsRunning(false);
      finishLiveMonitor("Next agent question saved in chat");
      return;
    }

    if (selected.stage === "customer") {
      draft.customer = value;
      const fallback = "Private customer fields stay local. Continue with the device model in the agent chat.";
      updateSelected({
        draft,
        messages: [
          ...nextMessages,
          { speaker: "agent", label: "Repair Ticket Agent", text: "OpenAI is preparing the next intake question..." },
        ],
        stage: "phone",
      });
      setIsRunning(true);
      beginLiveMonitor(["Saved local customer name", "Prepared next workflow step", "Asked OpenAI for phone step"]);
      const chat = await getOpenAiChatReply(selected.id, "phone", draft, fallback, accessCode);
      setSessions((current) =>
        current.map((session) =>
          session.id === selected.id
            ? {
                ...session,
                result: { ...session.result, modelMode: chat.modelMode },
                messages: [...nextMessages, { speaker: "agent", label: chat.modelMode, text: chat.reply }],
              }
            : session,
        ),
      );
      setIsRunning(false);
      finishLiveMonitor("Agent moved to phone step");
      return;
    }

    if (selected.stage === "phone") {
      draft.phone = value;
      const fallback = "What device is this repair for? Do not include customer name or phone.";
      updateSelected({
        draft,
        messages: [
          ...nextMessages,
          { speaker: "agent", label: "Repair Ticket Agent", text: "OpenAI is preparing the next intake question..." },
        ],
        stage: "device",
      });
      setIsRunning(true);
      beginLiveMonitor(["Saved local phone number", "Masked phone for any AI context", "Asked OpenAI for device step"]);
      const chat = await getOpenAiChatReply(selected.id, "device", draft, fallback, accessCode);
      setSessions((current) =>
        current.map((session) =>
          session.id === selected.id
            ? {
                ...session,
                result: { ...session.result, modelMode: chat.modelMode },
                messages: [...nextMessages, { speaker: "agent", label: chat.modelMode, text: chat.reply }],
              }
            : session,
        ),
      );
      setIsRunning(false);
      finishLiveMonitor("Agent moved to device step");
      return;
    }

    if (selected.stage === "device") {
      const parsed = parseInitialMessage(value);
      draft.device = parsed.device || value;
      const previewRecord = makeRecord(draft, selected.id);
      const previewResult = localAgent(previewRecord, result.modelMode);
      const fallback = "Enter the staff estimate before repair starts. Use numbers only, for example 189.";
      updateSelected({
        draft,
        record: previewRecord,
        result: previewResult,
        status: "Waiting for technician",
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Repair Ticket Agent",
            text: "OpenAI is preparing the estimate question...",
          },
        ],
        stage: "estimate",
      });
      setRepairFlow((current) => {
        const nextFlow = { ...current, ticketId: selected.id, device: draft.device, issue: draft.issue };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      setIsRunning(true);
      beginLiveMonitor([
        "Saved device model",
        "Created ticket before repair starts",
        "Asked staff for pre-repair estimate",
      ]);
      const chat = await getOpenAiChatReply(selected.id, "estimate", draft, fallback, accessCode);
      setSessions((current) =>
        current.map((session) =>
          session.id === selected.id
            ? {
                ...session,
                result: { ...session.result, modelMode: chat.modelMode },
                messages: [...nextMessages, { speaker: "agent", label: chat.modelMode, text: chat.reply }],
              }
            : session,
        ),
      );
      setIsRunning(false);
      finishLiveMonitor("Ticket is waiting for staff estimate");
      return;
    }

    if (selected.stage === "estimate") {
      const numericEstimate = value.replace(/[^0-9.]/g, "");
      draft.quotedPrice = numericEstimate;
      const estimateDisplay = numericEstimate ? `$${numericEstimate}.00 USD` : "$0.00 USD";
      updateSelected({
        draft,
        record: makeRecord(draft, selected.id),
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Repair Ticket Agent",
            text: "Estimate saved. Before repair starts, record the before-photo proof in the agent workflow. I will not move to technician notes until that proof is recorded.",
          },
        ],
        stage: "beforeProof",
        status: "Waiting for technician",
      });
      setRepairFlow((current) => {
        const nextFlow = {
          ...current,
          ticketId: selected.id,
          device: draft.device || current.device,
          issue: draft.issue || current.issue,
          repairEstimate: estimateDisplay,
          beforePhoto: "Missing" as const,
        };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      beginLiveMonitor([
        "Saved staff-entered estimate",
        "Confirmed AI did not generate the price",
        "Blocked repair flow until before-photo proof is recorded",
      ]);
      finishLiveMonitor("Ticket is waiting for before-photo proof");
      return;
    }

    if (selected.stage === "beforeProof") {
      updateSelected({
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Repair Workflow Agent",
            text: "Use the Record before proof button in Agent workflow. Technician notes stay locked until that proof is recorded.",
          },
        ],
      });
      return;
    }

    if (selected.stage === "ready") {
      draft.technicianNote = value;
      draft.beforeNote = draft.issue;
      setRepairFlow((current) => {
        const nextFlow = {
          ...current,
          ticketId: selected.id,
          technicianNote: value,
        };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      updateSelected({
        draft,
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Repair Ticket Agent",
            text: "I am analyzing the repair result now.",
          },
        ],
      });
      void finalizeWithAgent(draft);
      return;
    }

    if (selected.stage === "pickupEmail") {
      updateSelected({
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Pickup Email Agent",
            text: "Use the Send pickup email button in Agent workflow. The Warranty Agent will ask for after proof after the pickup email is processed.",
          },
        ],
      });
      return;
    }

    if (selected.stage === "afterProof") {
      updateSelected({
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Warranty Agent",
            text: "Use the Record after proof button before warranty signature. The warranty step stays locked until the after proof is recorded.",
          },
        ],
      });
      return;
    }

    const acceptedAt = new Date().toLocaleString();
    const warrantyPdfDataUrl = makeWarrantyPdfDataUrl(record, result, value, acceptedAt);
    updateSelected({
      agreementName: value,
      agreementAcceptedAt: acceptedAt,
      warrantyPdfDataUrl,
      stage: "complete",
      status: "Complete",
      record: { ...record, stage: "Picked up", pickupConfirmed: true },
      messages: [
        ...nextMessages,
        {
          speaker: "agent",
          label: "Agreement captured",
          text: `Warranty acceptance saved for ${value}. The Warranty Agent handed this ticket to the Square Payment Agent.`,
        },
      ],
    });
    finishLiveMonitor("Warranty acceptance saved; payment step is ready");
    void runWorkflowAction("warranty_acceptance");
  };

  const buildAgentProgress = (flow: RepairFlowState) => {
    const isPaid = flow.payment === "Paid";
    const isWarrantySigned = flow.warranty === "Signed";
    const hasBeforePhoto = flow.beforePhoto === "Uploaded";
    const hasAfterPhoto = flow.afterPhoto === "Uploaded";
    const pickupEmailSent = flow.pickupEmail === "Sent" || flow.pickupEmail === "Queued";
    const amountMatches = flow.squareAmount === flow.repairEstimate;
    const highRiskRepair = /water|liquid|motherboard|face id|fingerprint|no power|short/i.test(flow.issue);
    const canComplete = isPaid && isWarrantySigned && !highRiskRepair && flow.paymentReleasedToReview;
    const reviewReady = canComplete;

    const nextAgents: AgentWorker[] = [
      {
        ...finalAgentTeam[0],
        decision: !hasBeforePhoto
          ? "blocked_before_photo_missing"
          : highRiskRepair
            ? "intake_ready_high_risk"
            : "intake_ready",
        output: `Ticket ${flow.ticketId}: before photo is ${flow.beforePhoto}. Issue: ${flow.issue}`,
      },
      {
        ...finalAgentTeam[1],
        decision: !hasBeforePhoto
          ? "waiting_for_repair_agent"
          : flow.technicianNote === "Waiting for repair result."
            ? "waiting_for_technician_ready_note"
            : pickupEmailSent
              ? "pickup_email_sent"
              : "pickup_email_ready",
        output: `${flow.pickupEmail}. ${flow.pickupEmailReceipt}`,
      },
      {
        ...finalAgentTeam[2],
        decision: !pickupEmailSent
          ? "waiting_for_pickup_email"
          : !hasAfterPhoto
            ? "blocked_after_photo_missing"
            : isWarrantySigned
              ? "warranty_signed"
              : "ready_for_customer_signature",
        output: `After photo: ${flow.afterPhoto}. Technician note: ${flow.technicianNote}. Pickup: ${flow.pickup}. Warranty: ${flow.warranty}. ${flow.warrantyReceipt}`,
      },
      {
        ...finalAgentTeam[3],
        decision: !isWarrantySigned ? "waiting_for_warranty" : !isPaid ? "waiting_for_square_payment" : amountMatches ? "payment_confirmed" : "amount_mismatch",
        output: `${flow.squareEventType} ${flow.squareEventId}: Square payment ${flow.squarePaymentId} is ${flow.squareStatus} for ${flow.squareAmount}. Repair estimate is ${flow.repairEstimate}.`,
      },
      {
        ...finalAgentTeam[4],
        decision: reviewReady
          ? flow.reviewFollowUp === "Sent" || flow.reviewFollowUp === "Queued"
            ? "review_email_sent"
            : "review_email_ready"
          : "waiting_for_payment_completion",
        output:
          flow.reviewFollowUp === "Sent" || flow.reviewFollowUp === "Queued"
            ? flow.reviewReceipt
            : "Review email will be sent after warranty acceptance and Square payment are complete.",
      },
    ];

    const loopEvents: AgentLoopEvent[] = [
      {
        agent: nextAgents[0].name,
        inputFrom: "Repair ticket intake and before-photo proof",
        action: "Recorded before proof, then waited for technician ready note",
        decision: nextAgents[0].decision,
        handoffTo: "Pickup Email Agent",
        savedTo: "repair_cases / repair_photos / agent_activity_logs",
        details: [`AI decision: ${flow.aiNotes.repair}`, formatAgentUsage(flow.aiUsage.repair)],
      },
      {
        agent: nextAgents[1].name,
        inputFrom: "Technician ready note and customer email",
        action: "Checked readiness and processed ready-for-pickup email",
        decision: nextAgents[1].decision,
        handoffTo: "Warranty Agent",
        savedTo: "pickup_email_events / agent_activity_logs",
        details: [`AI decision: ${flow.aiNotes.pickup}`, formatAgentUsage(flow.aiUsage.pickup)],
      },
      {
        agent: nextAgents[2].name,
        inputFrom: "Pickup email confirmation and after-photo proof",
        action: "Recorded after proof and captured warranty acceptance",
        decision: nextAgents[2].decision,
        handoffTo: "Square Payment Agent",
        savedTo: "repair_photos / technician_notes / warranty_acceptances",
        details: [`AI decision: ${flow.aiNotes.warranty}`, formatAgentUsage(flow.aiUsage.warranty)],
      },
      {
        agent: nextAgents[3].name,
        inputFrom: "Warranty acceptance handoff",
        action: "Created/read Square Sandbox payment and compared payment amount",
        decision: nextAgents[3].decision,
        handoffTo: "Review Follow-up Agent",
        savedTo: "raw_square_events / square_events_cleaned / payments",
        details: [
          `AI decision: ${flow.aiNotes.payment}`,
          formatAgentUsage(flow.aiUsage.payment),
          `Warranty status: ${flow.warranty}`,
          `Requested amount: ${flow.repairEstimate}`,
          `Square status: ${flow.squareStatus}`,
          `Square amount: ${flow.squareAmount}`,
          `Payment ID: ${flow.squarePaymentId}`,
          `Receipt number: ${flow.squareReceiptNumber}`,
          `Card source: ${flow.squareCardSummary}`,
          `Receipt issued: ${flow.squareReceiptIssuedAt || "Waiting"}`,
          `Review handoff: ${flow.paymentReleasedToReview ? "released" : "waiting for staff review"}`,
        ],
      },
      {
        agent: nextAgents[4].name,
        inputFrom: "Confirmed payment event",
        action: "Processed thank-you and Google review follow-up email",
        decision: nextAgents[4].decision,
        handoffTo: "Staff dashboard",
        savedTo: "review_requests / agent_activity_logs",
        details: [`AI decision: ${flow.aiNotes.review}`, formatAgentUsage(flow.aiUsage.review)],
      },
    ];

    const completedCount =
      flow.reviewFollowUp === "Sent" || flow.reviewFollowUp === "Queued"
        ? 5
        : isPaid && flow.paymentReleasedToReview
          ? 4
          : isWarrantySigned
            ? 3
            : pickupEmailSent
              ? 2
              : hasBeforePhoto
                ? 1
                : 0;
    const activeIndex = completedCount >= 5 ? 4 : completedCount;

    return { activeIndex, completedCount, loopEvents, nextAgents };
  };

  const applyAgentProgress = (flow: RepairFlowState) => {
    const progress = buildAgentProgress(flow);
    setAgentWorkers(
      progress.nextAgents.map((agent, index) => ({
        ...agent,
        status: index < progress.completedCount ? "done" : index === progress.activeIndex ? "active" : "idle",
      })),
    );
    setAgentLoopEvents(progress.loopEvents.slice(0, progress.completedCount));
  };

  const appendWorkflowMessage = (label: string, text: string) => {
    if (!selected.id) return;
    setSessions((current) =>
      current.map((session) =>
        session.id === selected.id
          ? {
              ...session,
              messages: [
                ...session.messages,
                {
                  speaker: "agent",
                  label,
                  text,
                },
              ],
            }
          : session,
      ),
    );
  };

  const runWorkflowAction = async (
    action: "before_photo" | "pickup_email" | "after_photo" | "warranty_acceptance" | "review_request",
  ) => {
    setIsWorkflowWriting(true);
    const technicianProof = "Screen replaced. Display, touch, camera, speaker, and charging tested.";
    const monitorLabels =
      action === "before_photo"
        ? ["Repair Agent received drop-off record", "Recorded before photo proof", "Updated repair case database"]
        : action === "pickup_email"
          ? ["Pickup Email Agent checked before photo", "Sent or queued pickup email", "Stored email event"]
          : action === "after_photo"
            ? ["Warranty Agent checked pickup email", "Recorded after photo proof", "Stored technician test note"]
            : action === "warranty_acceptance"
              ? ["Warranty Agent checked after photo", "Captured customer pickup signature", "Stored warranty acceptance"]
              : ["Review Agent checked payment", "Sent or queued review email", "Stored review request"];
    beginLiveMonitor(monitorLabels);

    try {
      const response = await fetch("/api/repair-workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ticketId: workflowTicketId,
          customerName: privateCustomer.trim() || repairFlow.customerLabel,
          customerEmail: selected.customerEmail || privateEmail.trim() || repairFlow.customerEmail,
          device: repairFlow.device,
          issue: repairFlow.issue,
          repairSummary:
            action === "after_photo" && repairFlow.technicianNote !== "Waiting for repair result."
              ? repairFlow.technicianNote
              : action === "after_photo"
                ? technicianProof
                : repairFlow.technicianNote,
        }),
      });
      if (!response.ok) throw new Error("Workflow endpoint failed");

      const payload = (await response.json()) as {
        aiDecision?: {
          decision?: string;
          reason?: string;
          nextAction?: string;
          modelMode?: string;
          subject?: string;
          customerMessage?: string;
          warrantyStatement?: string;
          usage?: AgentTokenUsage;
        };
        emailEvent?: { status?: string; provider?: string; provider_message_id?: string; error?: string };
        warrantyAcceptance?: { status?: string; signed_at?: string };
        reviewRequest?: { status?: string; provider?: string; provider_message_id?: string; error?: string };
        photoRecord?: { photo_type?: string; file_label?: string };
        technicianNote?: { note_text?: string };
        databaseWrites?: Array<{ fileName?: string; operation?: string; totalRecords?: number }>;
      };
      const receipt =
        payload.databaseWrites
          ?.map((write) => `${write.operation} ${write.fileName} (${write.totalRecords} rows)`)
          .join(" · ") || "Stored workflow event in local database files.";
      const aiNote = payload.aiDecision
        ? `${payload.aiDecision.modelMode ?? "AI"} decided ${
            payload.aiDecision.decision ?? "decision_saved"
          }: ${
            payload.aiDecision.reason ?? "Reason saved."
          }${
            payload.aiDecision.customerMessage
              ? ` Generated message: ${payload.aiDecision.customerMessage}`
              : payload.aiDecision.warrantyStatement
                ? ` Generated warranty: ${payload.aiDecision.warrantyStatement}`
                : ""
          }`
        : "";
      const aiUsage = payload.aiDecision?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      setRepairFlow((current) => {
        const nextAiNotes = {
          ...current.aiNotes,
          ...(action === "before_photo" && aiNote ? { repair: aiNote } : {}),
          ...(action === "pickup_email" && aiNote ? { pickup: aiNote } : {}),
          ...((action === "after_photo" || action === "warranty_acceptance") && aiNote ? { warranty: aiNote } : {}),
          ...(action === "review_request" && aiNote ? { review: aiNote } : {}),
        };
        const nextAiUsage = {
          ...current.aiUsage,
          ...(action === "before_photo" ? { repair: aiUsage } : {}),
          ...(action === "pickup_email" ? { pickup: aiUsage } : {}),
          ...((action === "after_photo" || action === "warranty_acceptance") ? { warranty: aiUsage } : {}),
          ...(action === "review_request" ? { review: aiUsage } : {}),
        };
        const nextFlow =
          action === "before_photo"
            ? {
                ...current,
                aiNotes: nextAiNotes,
                aiUsage: nextAiUsage,
                ticketId: workflowTicketId,
                customerLabel: privateCustomer.trim() || current.customerLabel,
                customerEmail: selected.customerEmail || privateEmail.trim() || current.customerEmail,
                beforePhoto: "Uploaded" as const,
              }
            : action === "pickup_email"
            ? {
                ...current,
                aiNotes: nextAiNotes,
                aiUsage: nextAiUsage,
                ticketId: workflowTicketId,
                customerLabel: privateCustomer.trim() || current.customerLabel,
                customerEmail: selected.customerEmail || privateEmail.trim() || current.customerEmail,
                pickupEmail:
                  payload.emailEvent?.status === "sent"
                    ? ("Sent" as const)
                    : payload.emailEvent?.status === "send_failed"
                      ? ("Failed" as const)
                      : ("Queued" as const),
                pickupEmailReceipt: receipt,
              }
            : action === "after_photo"
              ? {
                  ...current,
                  aiNotes: nextAiNotes,
                  aiUsage: nextAiUsage,
                  ticketId: workflowTicketId,
                  afterPhoto: "Uploaded" as const,
                  technicianNote:
                    repairFlow.technicianNote !== "Waiting for repair result." ? repairFlow.technicianNote : technicianProof,
                  warrantyReceipt: receipt,
                }
            : action === "warranty_acceptance"
              ? {
                  ...current,
                  aiNotes: nextAiNotes,
                  aiUsage: nextAiUsage,
                  ticketId: workflowTicketId,
                  pickup: "Picked up" as const,
                  warranty: "Signed" as const,
                  warrantyReceipt: receipt,
                }
              : {
                  ...current,
                  aiNotes: nextAiNotes,
                  aiUsage: nextAiUsage,
                  ticketId: workflowTicketId,
                  reviewFollowUp:
                    payload.reviewRequest?.status === "sent"
                      ? ("Sent" as const)
                      : payload.reviewRequest?.status === "send_failed"
                        ? ("Failed" as const)
                        : ("Queued" as const),
                  reviewReceipt: receipt,
                };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      if (selected.id && action === "before_photo") {
        const updatedDraft = {
          ...selected.draft,
          beforePhotoPresent: true,
          beforeNote: selected.draft.issue,
        };
        const updatedRecord = makeRecord(updatedDraft, selected.id);
        const updatedResult = localAgent(updatedRecord, result.modelMode);
        updateSelected({
          draft: updatedDraft,
          record: updatedRecord,
          result: updatedResult,
          stage: "ready",
          status: "Waiting for technician",
        });
      }
      if (selected.id && action === "pickup_email") {
        updateSelected({
          stage: "afterProof",
          status: "Missing docs",
        });
      }
      if (selected.id && action === "after_photo") {
        const updatedDraft = {
          ...selected.draft,
          beforePhotoPresent: true,
          technicianNote:
            repairFlow.technicianNote !== "Waiting for repair result." ? repairFlow.technicianNote : technicianProof,
        };
        const updatedRecord = {
          ...makeRecord(updatedDraft, selected.id),
          afterPhotoPresent: true,
        };
        const updatedResult = localAgent(updatedRecord, result.modelMode);
        updateSelected({
          draft: updatedDraft,
          record: updatedRecord,
          result: updatedResult,
          stage: "agreement",
          status: "Warranty agreement",
        });
      }
      if (selected.id && action === "warranty_acceptance") {
        updateSelected({
          stage: "complete",
          status: "Complete",
          record: { ...record, stage: "Picked up", pickupConfirmed: true },
        });
      }
      const formatEmailDelivery = (event?: { status?: string; provider?: string; error?: string }) => {
        if (!event) return "unknown";
        if (event.status === "sent") return "sent";
        if (event.status === "local_outbox") return "queued";
        if (event.status === "send_failed") return "failed";
        return event.status ?? "unknown";
      };
      const emailDelivery =
        action === "pickup_email"
          ? formatEmailDelivery(payload.emailEvent)
          : action === "review_request"
            ? formatEmailDelivery(payload.reviewRequest)
            : "";
      const workflowMessages = {
        before_photo: `Before photo proof recorded for ${workflowTicketId}.`,
        pickup_email: `Pickup Email Agent generated the pickup message with AI and email ${emailDelivery}.`,
        after_photo: `Warranty Agent used AI to review after-proof and technician notes. After photo proof recorded.`,
        warranty_acceptance: `Warranty Agent generated the warranty acceptance statement with AI. Handoff to Square Payment Agent.`,
        review_request: `Review Follow-up Agent generated the review message with AI and email ${emailDelivery}.`,
      };
      appendWorkflowMessage(activeAgent.name, workflowMessages[action]);
      finishLiveMonitor("Database write confirmed");
    } catch {
      setRepairFlow((current) => {
        const nextFlow =
          action === "before_photo"
            ? { ...current, beforePhoto: "Missing" as const }
            : action === "pickup_email"
            ? { ...current, pickupEmail: "Failed" as const, pickupEmailReceipt: "Pickup email was not stored." }
            : action === "after_photo"
              ? { ...current, afterPhoto: "Missing" as const, warrantyReceipt: "After photo was not stored." }
            : action === "warranty_acceptance"
              ? { ...current, warrantyReceipt: "Warranty acceptance was not stored." }
              : { ...current, reviewFollowUp: "Failed" as const, reviewReceipt: "Review request was not stored." };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      appendWorkflowMessage(activeAgent.name, "The agent action failed, so no database write was confirmed.");
      finishLiveMonitor("Database write failed");
    } finally {
      setIsWorkflowWriting(false);
    }
  };

  const receiveSquarePayment = async () => {
    setIsSquareIngesting(true);
    beginLiveMonitor([
      "Payment Agent checked warranty signature",
      "Sent repair estimate to Square Sandbox",
      "Received sandbox card payment response",
      "Generated internal receipt record",
      "Stored payment database records",
    ]);

    try {
      const params = new URLSearchParams({
        ticketId: workflowTicketId,
        amountCents: String(moneyTextToCents(repairFlow.repairEstimate)),
      });
      const response = await fetch(`/api/square-sandbox?${params.toString()}`);
      if (!response.ok) throw new Error("Square Sandbox endpoint failed");

      const payload = (await response.json()) as {
        source?: string;
        aiDecision?: { decision?: string; reason?: string; nextAction?: string; modelMode?: string; usage?: AgentTokenUsage };
        cleanedPayment?: {
          eventId?: string;
          eventType?: string;
          merchantId?: string;
          paymentId?: string;
          amountDisplay?: string;
          status?: "APPROVED" | "PENDING" | "COMPLETED";
          sourceType?: string;
          receiptUrl?: string;
          receiptNumber?: string;
          cardLast4?: string;
          cardBrand?: string;
        };
        databaseWrites?: Array<{
          fileName?: string;
          operation?: string;
          totalRecords?: number;
        }>;
      };
      const payment = payload.cleanedPayment;
      const receipt =
        payload.databaseWrites
          ?.map((write) => `${write.operation} ${write.fileName} (${write.totalRecords} rows)`)
          .join(" · ") || "Stored Square event in local database files.";
      const aiNote = payload.aiDecision
        ? `${payload.aiDecision.modelMode ?? "AI"} decided ${
            payload.aiDecision.decision ?? "payment_checked"
          }: ${
            payload.aiDecision.reason ?? "Payment reasoning saved."
          }`
        : "";
      const aiUsage = payload.aiDecision?.usage ?? { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

      setRepairFlow((current) => {
        const nextFlow = {
          ...current,
          aiNotes: {
            ...current.aiNotes,
            ...(aiNote ? { payment: aiNote } : {}),
          },
          aiUsage: {
            ...current.aiUsage,
            payment: aiUsage,
          },
          squareSource: payload.source || current.squareSource,
          squareEventId: payment?.eventId || squareOfficialPaymentEvent.squareEventId,
          squareEventType: payment?.eventType || squareOfficialPaymentEvent.squareEventType,
          squareMerchantId: payment?.merchantId || current.squareMerchantId,
          squarePaymentId: payment?.paymentId || squareOfficialPaymentEvent.squarePaymentId,
          squareAmount: payment?.amountDisplay || squareOfficialPaymentEvent.squareAmount,
          squareStatus: payment?.status || squareOfficialPaymentEvent.squareStatus,
          squareSourceType: payment?.sourceType || current.squareSourceType,
          squareReceiptUrl: payment?.receiptUrl || current.squareReceiptUrl,
          squareReceiptNumber: payment?.receiptNumber || current.squareReceiptNumber,
          squareCardSummary:
            payment?.cardLast4 || payment?.cardBrand
              ? `${payment.cardBrand || "Card"} ending ${payment.cardLast4 || "unknown"}`
              : current.squareCardSummary,
          squareReceiptIssuedAt: new Date().toLocaleString(),
          paymentReleasedToReview: false,
          squareDatabaseReceipt: receipt,
          payment: "Paid" as const,
        };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      appendWorkflowMessage(
        "Square Payment Agent",
        `Square payment ${payment?.status?.toLowerCase() ?? "processed"}. Receipt and payment record saved.`,
      );
      finishLiveMonitor("Square payment database write confirmed");
    } catch {
      setRepairFlow((current) => {
        const nextFlow = {
          ...current,
          ...squareOfficialPaymentEvent,
          squareSource: "Square Sandbox fallback event",
          squareDatabaseReceipt: "Fallback Square event used; local database write was not confirmed.",
        };
        applyAgentProgress(nextFlow);
        return nextFlow;
      });
      appendWorkflowMessage("Square Payment Agent", "Square fallback event was used; database write was not confirmed.");
      finishLiveMonitor("Square payment database write failed");
    } finally {
      setIsSquareIngesting(false);
    }
  };

  const confirmPickupAndWarranty = () => {
    void runWorkflowAction("warranty_acceptance");
  };

  if (!isAccessUnlocked) {
    return (
      <main className={`${styles.page} ${styles.accessPage}`}>
        <section className={styles.accessCard}>
          <Image className={styles.accessLogo} src="/tnf-logo-visible.png" alt="Talk N Fix" width={220} height={90} priority />
          <p className={styles.sectionLabel}>Protected class demo</p>
          <h1>RepairOps AI dashboard</h1>
          <p>
            Enter the demo access code to open the agent workflow. The code is stored locally in this browser and is
            checked again before any AI request runs.
          </p>
          <label className={styles.accessField}>
            <span>Access code</span>
            <input
              type="password"
              value={accessInput}
              onChange={(event) => setAccessInput(event.target.value)}
              onKeyDown={handleAccessKeyDown}
              placeholder="Enter access code"
              autoComplete="off"
            />
          </label>
          {accessError ? <strong className={styles.accessError}>{accessError}</strong> : null}
          <button type="button" onClick={submitAccessCode} disabled={isCheckingAccess}>
            {isCheckingAccess ? "Checking..." : "Open dashboard"}
          </button>
          <small>Academic prototype. Do not enter real customer data in the public demo.</small>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.heroBrand}>
          <Image className={styles.brandLogo} src="/tnf-logo-visible.png" alt="Talk N Fix" width={220} height={90} priority />
          <div>
            <p className={styles.kicker}>Talk N Fix</p>
            <h1>
              RepairOps AI <span>dashboard</span>
            </h1>
          </div>
        </div>
        <a href="https://talknfixcherryhill.com/" target="_blank" rel="noreferrer">
          Public site source
        </a>
      </header>

      <section className={styles.layout}>
        <aside className={styles.recordsPanel}>
          <div className={styles.privateBox}>
            <div className={styles.privateHeader}>
              <strong>1</strong>
              <div>
                <p className={styles.sectionLabel}>Start here</p>
                <h2>Private customer info</h2>
              </div>
            </div>
            <p className={styles.commandIntro}>
              This information starts the shared team chat. The same chat follows each active agent.
            </p>
            <label className={styles.formField}>
              <span>Customer name</span>
              <input
                value={privateCustomer}
                onChange={(event) => setPrivateCustomer(event.target.value)}
                placeholder="Customer name"
              />
            </label>
            <label className={styles.formField}>
              <span>Phone number</span>
              <input
                value={privatePhone}
                onChange={(event) => setPrivatePhone(event.target.value)}
                placeholder="856-555-1842"
              />
            </label>
            <label className={styles.formField}>
              <span>Email for pickup notification</span>
              <input
                value={privateEmail}
                onChange={(event) => setPrivateEmail(event.target.value)}
                placeholder="customer@email.com"
              />
            </label>
            <small>Enter this before opening the agent. Name and phone stay local; email is used only for pickup/review workflow.</small>
          </div>
          <button
            className={styles.intakeButton}
            type="button"
            onClick={createNewTicket}
            disabled={isRunning || !privateCustomer.trim() || !privatePhone.trim()}
          >
            New repair ticket
          </button>
          <button className={styles.secondaryButton} type="button" onClick={clearSavedTickets}>
            Clear saved tickets
          </button>
          <p className={styles.sectionLabel}>Repair tickets · Saved locally</p>
          {sessions.length === 0 ? <p className={styles.emptyState}>No repair tickets yet.</p> : null}
          {sessions.map((session) => {
            const queueState = queueStateFor(session);
            return (
              <button
                className={`${styles.recordButton} ${session.id === selectedId ? styles.selectedRecord : ""}`}
                key={session.id}
                type="button"
                onClick={() => {
                  const nextFlow = flowFromSession(session);
                  setRepairFlow(nextFlow);
                  applyAgentProgress(nextFlow);
                  setSelectedId(session.id);
                  setAnswer("");
                }}
              >
                <span>{session.id}</span>
                <strong>{session.record.device}</strong>
                <small>{session.status}</small>
                <em>
                  {queueState.agent}
                  <b>{queueState.detail}</b>
                </em>
              </button>
            );
          })}
        </aside>

        <section className={styles.recordPanel}>
          <div className={styles.panelHeader}>
            <div>
              <p className={styles.sectionLabel}>Repair ticket</p>
              <h2>{record.device}</h2>
            </div>
            <span className={`${styles.riskBadge} ${styles[`risk${result.risk}`]}`}>{result.risk} risk</span>
          </div>

          <div className={styles.recordGrid}>
            <div>
              <span>Repair</span>
              <strong>{record.repairType}</strong>
            </div>
            <div>
              <span>Customer</span>
              <strong>
                {record.customer} · {record.maskedPhone}
              </strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{selected.status}</strong>
            </div>
            <div>
              <span>Source</span>
              <strong>{record.source}</strong>
            </div>
            <div>
              <span>Stage</span>
              <strong>{record.stage}</strong>
            </div>
            <div>
              <span>Staff estimate</span>
              <strong>{record.quotedPrice > 0 ? `$${record.quotedPrice}` : "Estimate pending"}</strong>
            </div>
          </div>

          <div className={styles.issueBox}>
            <span>Customer issue</span>
            <p>{record.issue}</p>
          </div>

          <div className={styles.outputGrid}>
            <article>
              <p className={styles.sectionLabel}>Technician note and agent findings</p>
              <ul className={styles.noteList}>
                {result.technicianNotes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </article>
            <article>
              <p className={styles.sectionLabel}>Missing documentation</p>
              {documentChecklist.length ? (
                <ul className={styles.missingList}>
                  {documentChecklist.map((field) => (
                    <li className={field.done ? styles.docDone : styles.docMissing} key={field.label}>
                      <strong>{field.done ? "Done" : "Missing"}</strong>
                      <span>{field.label}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              {documentChecklist.length && missingDocuments.length === 0 ? (
                <p className={styles.emptyState}>All required documentation is complete for this stage.</p>
              ) : null}
              {!documentChecklist.length ? (
                <p className={styles.emptyState}>Create or select a ticket to see required documentation.</p>
              ) : (
                null
              )}
            </article>
          </div>

          <div className={styles.acceptanceCard}>
            <span>Warranty acceptance</span>
            <strong>{selected.agreementName || "Not accepted yet"}</strong>
            {selected.agreementAcceptedAt ? <small>{selected.agreementAcceptedAt}</small> : null}
            {selected.warrantyPdfDataUrl ? (
              <button
                className={styles.pdfButton}
                type="button"
                onClick={() => downloadPdf(selected.warrantyPdfDataUrl, `${record.id}-warranty-acceptance.pdf`)}
              >
                Download warranty PDF
              </button>
            ) : null}
          </div>
        </section>

        <section className={styles.agentPanel}>
          <div className={styles.agentGlow}></div>
          <div className={styles.agentHeader}>
            <div className={styles.teamAvatarGroup} aria-hidden="true">
              {agentWorkers.map((agent, index) => (
                <span className={`${styles.teamAvatar} ${styles[`agentPortrait${index}`]} ${styles[`loop${agent.status}`]}`} key={agent.name}>
                  <span className={styles.teamSignal}></span>
                  <span className={styles.teamHead}></span>
                  <span className={styles.teamBody}></span>
                  <i>{index + 1}</i>
                </span>
              ))}
            </div>
            <div>
              <p className={styles.sectionLabel}>Command center</p>
              <h2>RepairOps team chat</h2>
              <small className={styles.teamChatHint}>One chat controls the active agent in the workflow above.</small>
            </div>
          </div>

          {selected.id ? (
            <div className={styles.modelStrip}>
              <span>Active agent</span>
              <strong>{activeAgent.name}</strong>
            </div>
          ) : null}

          {selected.id ? (
            <div className={styles.liveMonitor}>
              <div className={styles.timelineHeader}>
                <p className={styles.sectionLabel}>Live agent monitor</p>
                <button className={styles.monitorToggle} type="button" onClick={() => setIsMonitorOpen((current) => !current)}>
                  {isMonitorOpen ? "Hide" : isRunning ? "Running" : "Show"}
                </button>
              </div>
              {isMonitorOpen ? (
                liveMonitorSteps.map((step, index) => (
                  <div className={`${styles.liveStep} ${styles[step.status]}`} key={`${step.label}-${index}`}>
                    <strong>{step.status === "done" ? "✓" : index + 1}</strong>
                    <span>{step.label}</span>
                  </div>
                ))
              ) : (
                <div className={`${styles.liveStep} ${isRunning ? styles.active : styles.done}`}>
                  <strong>{isRunning ? "…" : "✓"}</strong>
                  <span>{liveMonitorSteps.find((step) => step.status === "active")?.label ?? liveMonitorSteps.at(-1)?.label}</span>
                </div>
              )}
            </div>
          ) : null}

          <div className={styles.chatBox} ref={chatBoxRef}>
            {selected.messages.map((message, index) => (
              <div
                className={message.speaker === "agent" ? styles.agentBubble : styles.userBubble}
                key={`${message.label}-${index}`}
              >
                <span>{message.speaker === "agent" ? "RepairOps team" : message.label}</span>
                <p>{message.text}</p>
              </div>
            ))}
            {isRunning ? (
              <div className={styles.agentBubble}>
                <span>{activeAgent.name} working</span>
                <p>Analyzing readiness note, checking risk, and drafting warranty output...</p>
              </div>
            ) : null}
          </div>

          {selected.stage !== "idle" &&
          selected.stage !== "pickupEmail" &&
          selected.stage !== "afterProof" &&
          selected.stage !== "agreement" &&
          selected.stage !== "complete" ? (
            <>
              <label className={styles.instructionBox}>
                <span>Reply to team chat</span>
                <textarea
                  value={answer}
                  onChange={(event) => setAnswer(event.target.value)}
                  onKeyDown={handleAnswerKeyDown}
                  placeholder={placeholder(selected.stage)}
                  rows={4}
                />
              </label>
              <button className={styles.runButton} type="button" onClick={submitAnswer} disabled={isRunning}>
                Continue workflow
              </button>
            </>
          ) : null}

          {selected.id && selected.stage === "idle" ? (
            <button
              className={styles.runButton}
              type="button"
              onClick={continueSelectedTicket}
              disabled={isRunning || !selected.id}
            >
              Continue selected ticket
            </button>
          ) : null}

          {selected.id ? (
            <button
              className={styles.secondaryDarkButton}
              type="button"
              onClick={() => deleteTicket(selected.id)}
            >
              Delete selected ticket
            </button>
          ) : null}

          {selected.id ? (
            <>
              <div className={styles.usageGrid}>
                <div>
                  <span>Prompt</span>
                  <strong>{result.promptTokens}</strong>
                </div>
                <div>
                  <span>Output</span>
                  <strong>{result.outputTokens}</strong>
                </div>
                <div>
                  <span>Cost</span>
                  <strong>${approximateCost}</strong>
                </div>
                <div>
                  <span>Runtime</span>
                  <strong>{result.runtimeMs}ms</strong>
                </div>
              </div>
            </>
          ) : null}

        </section>
      </section>

      {selected.id ? (
      <section className={styles.agenticLabPanel}>
        <div className={styles.labHeader}>
          <div>
            <p className={styles.sectionLabel}>Operations workspace</p>
            <h2>Agent workflow</h2>
            <span>One active agent at a time. The log records each handoff.</span>
          </div>
        </div>

        <div className={styles.agentStepRail} aria-label="Agent loop steps">
          {agentWorkers.map((agent, index) => (
            <div
              className={`${styles.agentStepButton} ${styles[`loop${agent.status}`]}`}
              key={agent.name}
            >
              <strong>
                <span className={styles.miniAgent}>
                  <span></span>
                </span>
                <i>{agent.status === "done" ? "✓" : index + 1}</i>
              </strong>
              <span>{agent.name}</span>
            </div>
          ))}
        </div>

        <article className={`${styles.activeAgentPanel} ${styles[`loop${activeAgent.status}`]}`}>
          <div className={styles.activeAgentHeader}>
            <div className={`${styles.agentFigure} ${styles.compactFigure} ${styles[`agentFigure${activeAgentIndex}`]} ${styles[`agentPortrait${activeAgentIndex}`]}`}>
              <span className={styles.agentSignal}></span>
              <span className={styles.agentHead}></span>
              <span className={styles.agentBody}></span>
              <span className={styles.agentTool}></span>
            </div>
            <div>
              <p className={styles.sectionLabel}>{activeAgent.domain}</p>
              <h3>{activeAgent.name}</h3>
            </div>
          </div>

          <div className={styles.activeAgentSummary}>
            <span>Decision</span>
            <strong>{activeAgent.decision}</strong>
          </div>

          {activeAgentIndex === 3 ? (
            <div className={styles.agentDecisionList}>
              <span>Payment Agent tool plan</span>
              <p className={repairFlow.warranty === "Signed" ? styles.doneCheck : ""}>
                Check warranty signature before payment
              </p>
              <p className={repairFlow.warranty === "Signed" ? styles.doneCheck : ""}>
                Send ticket estimate to Square Sandbox
              </p>
              <p className={repairFlow.payment === "Paid" ? styles.doneCheck : ""}>
                Read payment status, amount, card source, and receipt
              </p>
              <p className={repairFlow.payment === "Paid" ? styles.doneCheck : ""}>
                Store raw event, cleaned event, payment record, and ETL run
              </p>
              <p className={repairFlow.payment === "Paid" ? styles.doneCheck : ""}>
                Decide whether to hand off to Review Follow-up Agent
              </p>
            </div>
          ) : null}

          {(activeAgentIndex === 0 || activeAgentIndex === 2) ? (
            <div className={styles.photoProofStrip}>
              <span>Before photo: {repairFlow.beforePhoto}</span>
              <span>After photo: {repairFlow.afterPhoto}</span>
            </div>
          ) : null}

          <div className={styles.activeAgentAction}>
            {activeAgentIndex === 0 ? (
              <>
                <button
                  type="button"
                  onClick={() => void runWorkflowAction("before_photo")}
                  disabled={repairFlow.beforePhoto === "Uploaded" || isWorkflowWriting}
                >
                  {isWorkflowWriting ? "Saving..." : "Record before proof"}
                </button>
              </>
            ) : null}
            {activeAgentIndex === 1 ? (
              <button
                type="button"
                onClick={() => void runWorkflowAction("pickup_email")}
                disabled={
                  repairFlow.beforePhoto !== "Uploaded" ||
                  repairFlow.technicianNote === "Waiting for repair result." ||
                  repairFlow.pickupEmail === "Sent" ||
                  repairFlow.pickupEmail === "Queued" ||
                  isWorkflowWriting
                }
              >
                {isWorkflowWriting
                  ? "Sending..."
                  : repairFlow.technicianNote === "Waiting for repair result."
                    ? "Waiting for ready note"
                    : "Send pickup email"}
              </button>
            ) : null}
            {activeAgentIndex === 2 ? (
              <>
                <button
                  type="button"
                  onClick={() => void runWorkflowAction("after_photo")}
                  disabled={(repairFlow.pickupEmail !== "Sent" && repairFlow.pickupEmail !== "Queued") || repairFlow.afterPhoto === "Uploaded" || isWorkflowWriting}
                >
                  {isWorkflowWriting ? "Saving..." : "Record after proof"}
                </button>
                <button
                  type="button"
                  onClick={confirmPickupAndWarranty}
                  disabled={repairFlow.afterPhoto !== "Uploaded" || repairFlow.pickup === "Picked up" || isWorkflowWriting}
                >
                  Sign warranty
                </button>
              </>
            ) : null}
            {activeAgentIndex === 3 ? (
              <>
                <button
                  type="button"
                  onClick={receiveSquarePayment}
                  disabled={repairFlow.warranty !== "Signed" || repairFlow.payment === "Paid" || isSquareIngesting}
                >
                  {isSquareIngesting ? "Reading..." : "Read Square webhook"}
                </button>
                <a href={repairFlow.squareSourceUrl} target="_blank" rel="noreferrer">
                  Square source
                </a>
                {repairFlow.payment === "Paid" ? (
                  <div className={styles.squareReceiptCard}>
                    <span>Sandbox receipt record</span>
                    <p>
                      <b>{repairFlow.squareReceiptNumber}</b>
                      {repairFlow.squareReceiptIssuedAt ? ` · ${repairFlow.squareReceiptIssuedAt}` : ""}
                    </p>
                    <p>{repairFlow.squareAmount} · {repairFlow.squareCardSummary}</p>
                    <small>Payment ID: {repairFlow.squarePaymentId}</small>
                  </div>
                ) : null}
                {repairFlow.payment === "Paid" && !repairFlow.paymentReleasedToReview ? (
                  <button
                    type="button"
                    onClick={() => {
                      setRepairFlow((current) => {
                        const nextFlow = { ...current, paymentReleasedToReview: true };
                        applyAgentProgress(nextFlow);
                        return nextFlow;
                      });
                    }}
                  >
                    Continue to Review Agent
                  </button>
                ) : null}
              </>
            ) : null}
            {activeAgentIndex === 4 ? (
              <button
                type="button"
                onClick={() => void runWorkflowAction("review_request")}
                disabled={repairFlow.payment !== "Paid" || repairFlow.reviewFollowUp === "Sent" || repairFlow.reviewFollowUp === "Queued" || isWorkflowWriting}
                >
                  {isWorkflowWriting ? "Sending..." : "Send review email"}
                </button>
            ) : null}
          </div>
        </article>

        <div className={styles.agentLoopLog}>
          <div className={styles.timelineHeader}>
            <p className={styles.sectionLabel}>Agent team loop log</p>
            <span>{agentLoopEvents.length ? `${agentLoopEvents.length} actions saved` : "Waiting"}</span>
          </div>
          {agentLoopEvents.length ? (
            agentLoopEvents.map((event, index) => (
              <details className={styles.loopLogRow} key={`${event.agent}-${event.decision}`}>
                <summary>
                  <strong>{index + 1}</strong>
                  <span>{event.agent}</span>
                  <b>{event.decision}</b>
                </summary>
                <div className={styles.loopLogBody}>
                  <p>
                    Received: <b>{event.inputFrom}</b>
                  </p>
                  <p>
                    Action: <b>{event.action}</b>
                  </p>
                  <p>
                    Decision: <b>{event.decision}</b>
                  </p>
                  <p>
                    Handoff: <b>{event.handoffTo}</b>
                  </p>
                  {event.details?.length ? (
                    <ul className={styles.loopDetailList}>
                      {event.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                  {event.receiptUrl ? (
                    <a className={styles.loopReceiptLink} href={event.receiptUrl} target="_blank" rel="noreferrer">
                      View Square receipt
                    </a>
                  ) : null}
                  <small>Saved to {event.savedTo}</small>
                </div>
              </details>
            ))
          ) : (
            <p className={styles.emptyState}>
              Start inside the Repair Agent. Each completed action creates a handoff record for the next agent.
            </p>
          )}
        </div>
      </section>
      ) : null}

      {selected.stage === "agreement" ? (
        <div className={styles.modalOverlay} role="dialog" aria-modal="true" aria-labelledby="warranty-title">
          <section className={styles.warrantyModal}>
            <p className={styles.sectionLabel}>Customer warranty agreement</p>
            <h2 id="warranty-title">Talk N Fix Limited Warranty</h2>
            <dl>
              <div>
                <dt>Ticket</dt>
                <dd>{record.id}</dd>
              </div>
              <div>
                <dt>Customer</dt>
                <dd>{record.customer}</dd>
              </div>
              <div>
                <dt>Device</dt>
                <dd>{record.device}</dd>
              </div>
            </dl>
            <p>{result.warrantySummary}</p>
            <p>
              I confirm that I received my repaired device in working condition, reviewed the repair result, and accepted
              the device at pickup. I understand that this limited warranty covers the installed part and repair labor
              for 90 days. It does not cover physical damage, water damage, or customer-caused damage after pickup.
            </p>
            <label className={styles.modalField}>
              <span>Customer name for acceptance</span>
              <input
                value={answer}
                onChange={(event) => setAnswer(event.target.value)}
                placeholder={record.customer.startsWith("Customer ") ? "Type customer name" : record.customer}
              />
            </label>
            <div className={styles.modalActions}>
              <button type="button" onClick={submitAnswer} disabled={!answer.trim()}>
                I received my repaired device working
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}
