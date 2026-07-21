"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import styles from "./page.module.css";

type RiskLevel = "Low" | "Medium" | "High";
type RepairStage = "Drop-off" | "Repair in progress" | "Ready for pickup" | "Picked up";
type StepState = "complete" | "active" | "pending";
type FlowStage =
  | "idle"
  | "problem"
  | "customer"
  | "phone"
  | "device"
  | "estimate"
  | "ready"
  | "agreement"
  | "approval"
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
    status: "Created" | "Ready for approval";
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

type TicketStatus = "Demo record" | "Missing docs" | "Waiting for technician" | "Warranty agreement" | "Staff approval" | "Complete";
type MonitorStatus = "done" | "active" | "pending";

type LiveMonitorStep = {
  label: string;
  status: MonitorStatus;
};

type TicketSession = {
  id: string;
  record: RepairRecord;
  result: AgentResult;
  draft: IntakeForm;
  messages: Message[];
  stage: FlowStage;
  status: TicketStatus;
  agreementName: string;
  agreementAcceptedAt: string;
  warrantyPdfDataUrl: string;
};

const steps = ["Problem", "Device", "Estimate", "Repair ready", "Warranty page", "Staff approve"];
const storageKey = "repairops-ai-ticket-sessions";
const accessStorageKey = "repairops-ai-demo-access-code";

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
  beforePhotoPresent: true,
};

const repairRecords: RepairRecord[] = [
  {
    id: "R-1042",
    customer: "Customer A",
    maskedPhone: "***-***-1527",
    device: "iPhone 14 Pro",
    repairType: "Screen replacement",
    issue: "Cracked front glass after drop. Touch still works.",
    source: "Talk N Fix website quote",
    customerType: "New",
    stage: "Drop-off",
    paymentStatus: "Pending",
    quotedPrice: 189,
    beforeNote: "Screen cracked across bottom edge. Touch working. No liquid damage reported.",
    afterNote: "",
    warrantyAccepted: true,
    pickupConfirmed: false,
    testedAtPickup: false,
    beforePhotoPresent: true,
    afterPhotoPresent: false,
  },
  {
    id: "R-1044",
    customer: "Customer C",
    maskedPhone: "***-***-6002",
    device: "iPad Air",
    repairType: "Water damage diagnostic",
    issue: "Device stopped powering on after spill.",
    source: "Google Maps",
    customerType: "New",
    stage: "Drop-off",
    paymentStatus: "Pending",
    quotedPrice: 49,
    beforeNote: "",
    afterNote: "",
    warrantyAccepted: false,
    pickupConfirmed: false,
    testedAtPickup: false,
    beforePhotoPresent: false,
    afterPhotoPresent: false,
  },
  {
    id: "R-1048",
    customer: "Customer G",
    maskedPhone: "***-***-9190",
    device: "iPhone 13 Pro",
    repairType: "Face ID diagnostic",
    issue: "Face ID stopped working after screen damage.",
    source: "Website quote",
    customerType: "New",
    stage: "Repair in progress",
    paymentStatus: "Pending",
    quotedPrice: 0,
    beforeNote: "Screen cracked near top sensor area. Face ID not working before repair.",
    afterNote: "",
    warrantyAccepted: true,
    pickupConfirmed: false,
    testedAtPickup: false,
    beforePhotoPresent: true,
    afterPhotoPresent: false,
  },
];

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
    device: draft.device || "Device pending",
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

function localAgent(record: RepairRecord, modelMode = "OpenAI not run yet"): AgentResult {
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
  const covered = risk !== "High";
  const taskTitle = covered
    ? `Prepare warranty agreement for ${record.id}`
    : `Manager review required for ${record.id}`;

  return {
    missingFields,
    risk,
    warrantySummary: covered
      ? `${record.device} repair has a 90-day limited warranty for the installed part and repair labor. Physical damage, water damage, and customer-caused damage are excluded.`
      : `${record.id} needs manager review before warranty approval because the notes mention a high-risk condition.`,
    followUpDraft: covered
      ? `Hi ${record.customer}, your ${record.device} is ready. Your repair includes a 90-day limited warranty for the installed part and service, excluding physical or water damage.`
      : `Hi ${record.customer}, your ${record.device} repair needs a quick manager review before we finalize warranty and pickup details.`,
    agentReply: `I created ${record.id}, analyzed the repair readiness note, assigned ${risk.toLowerCase()} risk, drafted warranty language, and created the staff task.`,
    nextAction: covered ? "Ask the customer to agree to the warranty terms, then staff can approve pickup." : "Send this ticket to manager review.",
    technicianNotes: record.afterNote
      ? [
          `Technician submitted: ${record.afterNote}`,
          covered
            ? "Agent finding: normal warranty path is allowed after customer agreement."
            : "Agent finding: hold warranty and follow-up until manager review.",
        ]
      : ["Waiting for technician repair-ready note."],
    followUpDecision: covered ? "Ready after customer warranty agreement" : "Hold follow-up until manager review",
    modelMode,
    staffTask: {
      title: taskTitle,
      priority: risk,
      owner: risk === "High" ? "Manager review" : "Front counter staff",
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
      `Created staff task: ${taskTitle}`,
    ],
  };
}

function statusFor(record: RepairRecord, result: AgentResult): TicketStatus {
  if (result.missingFields.length > 0) return "Missing docs";
  if (!record.afterNote) return "Waiting for technician";
  if (result.risk === "High") return "Staff approval";
  return "Warranty agreement";
}

function makeSession(record: RepairRecord): TicketSession {
  const result = localAgent(record);
  return {
    id: record.id,
    record,
    result,
    draft: { ...emptyIntake, issue: record.issue, customer: record.customer, device: record.device },
    messages: [
      {
        speaker: "agent",
        label: "Repair Ticket Agent",
        text: `Existing ticket ${record.id} loaded. Status: ${statusFor(record, result)}.`,
      },
    ],
    stage: "idle",
    status: statusFor(record, result),
    agreementName: "",
    agreementAcceptedAt: "",
    warrantyPdfDataUrl: "",
  };
}

function makeDefaultSessions() {
  return repairRecords.map(makeSession);
}

function loadSavedSessions() {
  if (typeof window === "undefined") return makeDefaultSessions();

  try {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) return makeDefaultSessions();
    const parsed = JSON.parse(saved) as TicketSession[];
    if (!Array.isArray(parsed) || parsed.length === 0) return makeDefaultSessions();

    return parsed.map((session) => ({
      ...session,
      agreementAcceptedAt: session.agreementAcceptedAt ?? "",
      warrantyPdfDataUrl: session.warrantyPdfDataUrl ?? "",
      result: session.result,
    }));
  } catch {
    return makeDefaultSessions();
  }
}

function placeholder(stage: FlowStage) {
  if (stage === "problem") return "Screen is broken. No customer name or phone here.";
  if (stage === "customer") return "Customer name";
  if (stage === "phone") return "856-555-1842";
  if (stage === "device") return "iPhone 13 Pro";
  if (stage === "estimate") return "189";
  if (stage === "ready") return "Repair/diagnostic completed: screen replaced, display and touch tested, device is working at pickup.";
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

async function getOpenAiChatReply(
  ticketId: string,
  nextStage: FlowStage,
  draft: IntakeForm,
  fallback: string,
  accessCode: string,
) {
  if (nextStage === "idle" || nextStage === "approval" || nextStage === "complete") {
    return { reply: fallback, modelMode: "OpenAI not run yet" };
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
  const [sessions, setSessions] = useState<TicketSession[]>(makeDefaultSessions);
  const [selectedId, setSelectedId] = useState(repairRecords[0].id);
  const [answer, setAnswer] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [hasLoadedSavedTickets, setHasLoadedSavedTickets] = useState(false);
  const [privateCustomer, setPrivateCustomer] = useState("");
  const [privatePhone, setPrivatePhone] = useState("");
  const [isMonitorOpen, setIsMonitorOpen] = useState(true);
  const [accessCode, setAccessCode] = useState("");
  const [accessInput, setAccessInput] = useState("");
  const [accessError, setAccessError] = useState("");
  const [isAccessUnlocked, setIsAccessUnlocked] = useState(false);
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [liveMonitorSteps, setLiveMonitorSteps] = useState<LiveMonitorStep[]>([
    { label: "Waiting for staff action", status: "active" },
    { label: "Private customer fields stay local", status: "pending" },
    { label: "Agent output will appear after each workflow step", status: "pending" },
  ]);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const monitorRunRef = useRef(0);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [selectedId, sessions],
  );
  const record = selected.record;
  const result = selected.result;
  const estimatedCost = ((result.promptTokens + result.outputTokens) * 0.0000006).toFixed(4);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const savedSessions = loadSavedSessions();
      const savedAccessCode = window.localStorage.getItem(accessStorageKey) ?? "";
      setSessions(savedSessions);
      setSelectedId(savedSessions[0].id);
      setAccessCode(savedAccessCode);
      setAccessInput(savedAccessCode);
      setIsAccessUnlocked(Boolean(savedAccessCode));
      setHasLoadedSavedTickets(true);
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
    if (!value) {
      setAccessError("Enter the demo access code.");
      return;
    }

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

      window.localStorage.setItem(accessStorageKey, value);
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
    setPrivateCustomer("");
    setPrivatePhone("");
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
      device: record.device === "Device pending" ? "" : record.device,
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
    const safeSessions = nextSessions.length > 0 ? nextSessions : makeDefaultSessions();
    setSessions(safeSessions);
    if (id === selectedId) {
      setSelectedId(safeSessions[0].id);
      setAnswer("");
    }
  };

  const clearSavedTickets = () => {
    const defaultSessions = makeDefaultSessions();
    window.localStorage.removeItem(storageKey);
    setSessions(defaultSessions);
    setSelectedId(defaultSessions[0].id);
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
        stage: "agreement",
        status: nextResult.risk === "High" ? "Staff approval" : "Warranty agreement",
        messages: [
          ...selected.messages,
          {
            speaker: "agent",
            label: nextResult.modelMode,
            text: `${nextRecord.id} is ready for warranty review. I drafted the 90-day warranty text and marked the next required action.`,
          },
          {
            speaker: "agent",
            label: "Warranty agreement",
            text: "I opened the warranty agreement popup for the customer.",
          },
        ],
      });
      finishLiveMonitor("Agent output saved to the selected ticket");
    } catch {
      const nextResult = localAgent(localRecord, "Local safety workflow");
      updateSelected({
        record: localRecord,
        result: nextResult,
        stage: "agreement",
        status: nextResult.risk === "High" ? "Staff approval" : "Warranty agreement",
        messages: [
          ...selected.messages,
          {
            speaker: "agent",
            label: "Local safety workflow",
            text: `${localRecord.id} is ready for warranty review. The API did not complete, so I used the local workflow.`,
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
    if (!value || isRunning || selected.stage === "idle" || selected.stage === "complete" || selected.stage === "approval") return;
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
        status: previewResult.risk === "High" ? "Staff approval" : "Waiting for technician",
        messages: [
          ...nextMessages,
          { speaker: "agent", label: "Repair Ticket Agent", text: "OpenAI is preparing the next intake question..." },
        ],
        stage: nextStage,
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
        status: previewResult.risk === "High" ? "Staff approval" : "Waiting for technician",
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
      const fallback =
        "Estimate saved. When repair or diagnostic is completed, enter the technician result: what was found, what was replaced, test result, and anything still not working.";
      updateSelected({
        draft,
        record: makeRecord(draft, selected.id),
        messages: [
          ...nextMessages,
          {
            speaker: "agent",
            label: "Repair Ticket Agent",
            text: "OpenAI is preparing the technician update question...",
          },
        ],
        stage: "ready",
        status: "Waiting for technician",
      });
      setIsRunning(true);
      beginLiveMonitor([
        "Saved staff-entered estimate",
        "Confirmed AI did not generate the price",
        "Moved ticket to repair/diagnostic waiting step",
      ]);
      const chat = await getOpenAiChatReply(selected.id, "ready", draft, fallback, accessCode);
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
      finishLiveMonitor("Ticket is waiting for repair or diagnostic completion");
      return;
    }

    if (selected.stage === "ready") {
      draft.technicianNote = value;
      draft.beforeNote = draft.issue;
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

    const acceptedAt = new Date().toLocaleString();
    const warrantyPdfDataUrl = makeWarrantyPdfDataUrl(record, result, value, acceptedAt);
    updateSelected({
      agreementName: value,
      agreementAcceptedAt: acceptedAt,
      warrantyPdfDataUrl,
      stage: "approval",
      status: "Staff approval",
      messages: [
        ...nextMessages,
        {
          speaker: "agent",
          label: "Agreement captured",
          text: `Warranty acceptance saved for ${value}: customer confirmed they received the repaired device in working condition.`,
        },
      ],
    });
    finishLiveMonitor("Warranty acceptance saved for dispute record");
  };

  const approveTicket = () => {
    beginLiveMonitor(["Reviewing warranty acceptance", "Marking pickup complete", "Closing staff task"]);
    updateSelected({
      stage: "complete",
      status: "Complete",
      record: { ...record, stage: "Picked up", pickupConfirmed: true, paymentStatus: "Paid" },
      result: {
        ...result,
        staffTask: { ...result.staffTask, status: "Ready for approval" },
        logs: [
          ...result.logs,
          "Warranty acceptance captured: customer received repaired device in working condition",
          "Staff approved pickup and follow-up",
        ],
      },
      messages: [
        ...selected.messages,
        {
          speaker: "agent",
          label: "Complete",
          text: "Staff approved the ticket. Warranty acceptance, repaired-device pickup confirmation, and follow-up draft are complete.",
        },
      ],
    });
    finishLiveMonitor("Ticket completed and saved locally");
  };

  const stepStates: StepState[] = steps.map((_, index) => {
    const order: FlowStage[] = ["problem", "device", "estimate", "ready", "agreement", "approval", "complete"];
    const position = selected.stage === "idle" ? 0 : order.indexOf(selected.stage);
    if (selected.stage === "complete") return "complete";
    if (index < Math.max(0, position - 1)) return "complete";
    if (index === Math.max(0, position - 1)) return "active";
    return "pending";
  });

  if (!isAccessUnlocked) {
    return (
      <main className={`${styles.page} ${styles.accessPage}`}>
        <section className={styles.accessCard}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.accessLogo} src="/tnf-logo-visible.png" alt="Talk N Fix" />
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
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.brandLogo} src="/tnf-logo-visible.png" alt="Talk N Fix" />
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

      <section className={styles.steps} aria-label="Dashboard workflow steps">
        {steps.map((step, index) => (
          <div className={`${styles.step} ${styles[stepStates[index]]}`} key={step}>
            <strong>
              <span>{stepStates[index] === "complete" ? "✓" : index + 1}</span>
            </strong>
            <span>{step}</span>
          </div>
        ))}
      </section>

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
            <small>Enter this before opening the agent. Name and phone stay local.</small>
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
          {sessions.map((session) => (
            <button
              className={`${styles.recordButton} ${session.id === selectedId ? styles.selectedRecord : ""}`}
              key={session.id}
              type="button"
              onClick={() => {
                setSelectedId(session.id);
                setAnswer("");
              }}
            >
              <span>{session.id}</span>
              <strong>{session.record.device}</strong>
              <small>{session.status}</small>
            </button>
          ))}
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
              {result.missingFields.length ? (
                <ul className={styles.missingList}>
                  {result.missingFields.map((field) => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              ) : (
                <p className={styles.emptyState}>No missing documentation found.</p>
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
            <div className={styles.agentAvatar} aria-hidden="true">
              <span className={styles.techCap}></span>
              <span className={styles.techFace}></span>
              <span className={styles.techTool}></span>
            </div>
            <div>
              <p className={styles.sectionLabel}>AI agent console</p>
              <h2>Repair Ticket Agent</h2>
            </div>
          </div>

          <div className={styles.modelStrip}>
            <span>Agent runtime</span>
            <strong>{result.modelMode}</strong>
          </div>

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

          <div className={styles.chatBox} ref={chatBoxRef}>
            {selected.messages.map((message, index) => (
              <div
                className={message.speaker === "agent" ? styles.agentBubble : styles.userBubble}
                key={`${message.label}-${index}`}
              >
                <span>{message.label}</span>
                <p>{message.text}</p>
              </div>
            ))}
            {isRunning ? (
              <div className={styles.agentBubble}>
                <span>Agent working</span>
                <p>Analyzing readiness note, checking risk, and drafting warranty output...</p>
              </div>
            ) : null}
          </div>

          {selected.stage !== "idle" && selected.stage !== "agreement" && selected.stage !== "approval" && selected.stage !== "complete" ? (
            <>
              <label className={styles.instructionBox}>
                <span>Answer the agent</span>
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

          {selected.stage === "idle" ? (
            <button className={styles.runButton} type="button" onClick={continueSelectedTicket} disabled={isRunning}>
              Continue selected ticket
            </button>
          ) : null}

          <button className={styles.secondaryDarkButton} type="button" onClick={() => deleteTicket(selected.id)}>
            Delete selected ticket
          </button>

          <div className={styles.taskCard}>
            <div>
              <p className={styles.sectionLabel}>Generated staff task</p>
              <h3>{result.staffTask.title}</h3>
            </div>
            <dl>
              <div>
                <dt>Priority</dt>
                <dd>{result.staffTask.priority}</dd>
              </div>
              <div>
                <dt>Owner</dt>
                <dd>{result.staffTask.owner}</dd>
              </div>
              <div>
                <dt>Status</dt>
                <dd>{selected.status}</dd>
              </div>
            </dl>
            <button type="button" onClick={approveTicket} disabled={selected.stage !== "approval"}>
              Staff approve
            </button>
          </div>

          <div className={styles.summaryBox}>
            <p className={styles.sectionLabel}>Warranty summary</p>
            <span>{result.warrantySummary}</span>
          </div>

          <div className={styles.summaryBox}>
            <p className={styles.sectionLabel}>Follow-up draft</p>
            <span>{result.followUpDraft}</span>
          </div>

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
              <strong>${estimatedCost}</strong>
            </div>
            <div>
              <span>Runtime</span>
              <strong>{result.runtimeMs}ms</strong>
            </div>
          </div>

          <div className={styles.timelinePanel}>
            <div className={styles.timelineHeader}>
              <p className={styles.sectionLabel}>Activity audit log</p>
              <span>{isRunning ? "Running" : "Saved"}</span>
            </div>
            {result.logs.map((log, index) => (
              <div className={styles.timelineStep} key={`${log}-${index}`}>
                <strong>{index + 1}</strong>
                <span>{log}</span>
              </div>
            ))}
            {selected.agreementName ? (
              <div className={styles.timelineStep}>
                <strong>{result.logs.length + 1}</strong>
                <span>
                  Warranty acceptance saved for {selected.agreementName} on {selected.agreementAcceptedAt}. Customer
                  confirmed they received the repaired device in working condition.
                </span>
              </div>
            ) : null}
          </div>

        </section>
      </section>

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
