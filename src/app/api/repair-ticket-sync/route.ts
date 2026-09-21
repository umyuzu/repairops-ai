import { NextResponse } from "next/server";
import { getPool, maskPhone, normalizeId } from "@/lib/postgres";

export const runtime = "nodejs";

type RepairTicketSyncRequest = {
  repairTicketId?: string;
  customerName?: string;
  phone?: string;
  email?: string;
  deviceModel?: string;
  problemDescription?: string;
  estimateAmount?: number;
  status?: string;
  riskLevel?: "low" | "medium" | "high";
};

export async function POST(request: Request) {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({
      saved: false,
      reason: "DATABASE_URL is not configured.",
    });
  }

  const body = (await request.json()) as RepairTicketSyncRequest;
  const repairTicketId = body.repairTicketId?.trim();

  if (!repairTicketId) {
    return NextResponse.json({ saved: false, reason: "repairTicketId is required." }, { status: 400 });
  }

  const customerSeed = normalizeId(body.customerName || repairTicketId, repairTicketId);
  const customerId = `C-${customerSeed}`.slice(0, 48);
  const deviceId = `D-${repairTicketId}`.slice(0, 48);
  const customerName = body.customerName?.trim() || "Demo Customer";
  const maskedPhone = maskPhone(body.phone ?? "");
  const maskedEmail = body.email ? "provided@example.com" : null;
  const deviceModel = body.deviceModel?.trim() || "Device not entered yet";
  const problemDescription = body.problemDescription?.trim() || "Customer issue pending.";
  const estimateAmount = Number.isFinite(body.estimateAmount) ? body.estimateAmount : 0;
  const status = body.status?.trim() || "created_from_web_app";
  const riskLevel = body.riskLevel ?? "low";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO customers (customer_id, display_name, masked_phone, masked_email, customer_type)
       VALUES ($1, $2, $3, $4, 'new')
       ON CONFLICT (customer_id) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         masked_phone = EXCLUDED.masked_phone,
         masked_email = EXCLUDED.masked_email`,
      [customerId, customerName, maskedPhone, maskedEmail],
    );
    await client.query(
      `INSERT INTO devices (device_id, customer_id, device_model, device_family, serial_number_masked)
       VALUES ($1, $2, $3, $4, NULL)
       ON CONFLICT (device_id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         device_model = EXCLUDED.device_model,
         device_family = EXCLUDED.device_family`,
      [deviceId, customerId, deviceModel, deviceModel.split(" ")[0] || null],
    );
    await client.query(
      `INSERT INTO repair_tickets (
         repair_ticket_id,
         customer_id,
         device_id,
         problem_description,
         repair_type,
         status,
         estimate_amount,
         risk_level
       )
       VALUES ($1, $2, $3, $4, 'intake', $5, $6, $7)
       ON CONFLICT (repair_ticket_id) DO UPDATE SET
         customer_id = EXCLUDED.customer_id,
         device_id = EXCLUDED.device_id,
         problem_description = EXCLUDED.problem_description,
         status = EXCLUDED.status,
         estimate_amount = EXCLUDED.estimate_amount,
         risk_level = EXCLUDED.risk_level,
         updated_at = CURRENT_TIMESTAMP`,
      [repairTicketId, customerId, deviceId, problemDescription, status, estimateAmount, riskLevel],
    );
    await client.query("COMMIT");

    return NextResponse.json({
      saved: true,
      repairTicketId,
      tables: ["customers", "devices", "repair_tickets"],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    return NextResponse.json(
      {
        saved: false,
        reason: error instanceof Error ? error.message : "Repair ticket database sync failed.",
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({
      saved: false,
      reason: "DATABASE_URL is not configured.",
    });
  }

  const body = (await request.json()) as { repairTicketId?: string };
  const repairTicketId = body.repairTicketId?.trim();

  if (!repairTicketId) {
    return NextResponse.json({ saved: false, reason: "repairTicketId is required." }, { status: 400 });
  }

  try {
    const result = await pool.query(
      `UPDATE repair_tickets
       SET status = 'deleted_from_web_app',
           updated_at = CURRENT_TIMESTAMP
       WHERE repair_ticket_id = $1`,
      [repairTicketId],
    );

    return NextResponse.json({
      saved: true,
      repairTicketId,
      archived: (result.rowCount ?? 0) > 0,
    });
  } catch (error) {
    return NextResponse.json(
      {
        saved: false,
        reason: error instanceof Error ? error.message : "Repair ticket archive failed.",
      },
      { status: 500 },
    );
  }
}
