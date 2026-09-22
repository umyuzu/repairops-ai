import { NextResponse } from "next/server";
import { getPool } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DashboardSummaryRow = {
  total_repairs: number;
  active_repairs: number;
  waiting_for_pickup: number;
  high_risk_repairs: number;
  estimated_repair_value: string;
  paid_revenue: string;
  pending_payments: number;
  failed_payments: number;
  payment_records_needing_review: number;
};

type DataCleaningSummaryRow = {
  total_tickets: number;
  incomplete_device_records: number;
  missing_before_photos: number;
  missing_after_photos: number;
  missing_warranties: number;
  missing_payments: number;
  nonstandard_payment_statuses: number;
  cleaned_square_events: number;
  photo_records: number;
  technician_note_records: number;
};

export async function GET() {
  const pool = getPool();
  if (!pool) {
    return NextResponse.json({
      connected: false,
      reason: "DATABASE_URL is not configured.",
      summary: null,
      repairs: [],
      paymentStatus: [],
      repairStatus: [],
      deviceFamilies: [],
      warrantyCoverage: null,
    });
  }

  try {
    const [
      summaryResult,
      repairsResult,
      paymentStatusResult,
      repairStatusResult,
      deviceFamilyResult,
      warrantyCoverageResult,
      dataCleaningResult,
      documentationGapResult,
    ] = await Promise.all([
      pool.query<DashboardSummaryRow>("SELECT * FROM dashboard_summary LIMIT 1"),
      pool.query(
        `SELECT
          repair_ticket_id,
          display_name,
          device_model,
          repair_type,
          repair_status,
          risk_level,
          estimate_amount,
          payment_amount,
          payment_status,
          needs_review
        FROM repair_payment_overview
        ORDER BY repair_updated_at DESC NULLS LAST, repair_ticket_id DESC
        LIMIT 12`,
      ),
      pool.query(
        `SELECT payment_status, repair_count, total_amount
        FROM payment_status_summary
        ORDER BY repair_count DESC, payment_status`,
      ),
      pool.query(
        `SELECT repair_status, repair_count, estimated_value
        FROM repair_status_summary
        ORDER BY repair_count DESC, repair_status`,
      ),
      pool.query(
        `SELECT device_family, repair_count, estimated_value
        FROM repairs_by_device_family
        ORDER BY repair_count DESC, estimated_value DESC`,
      ),
      pool.query("SELECT * FROM warranty_coverage_summary LIMIT 1"),
      pool.query<DataCleaningSummaryRow>(
        `SELECT
          COUNT(*)::int AS total_tickets,
          COUNT(*) FILTER (
            WHERE d.device_model IS NULL
              OR d.device_model = ''
              OR d.device_model ILIKE 'Device not entered yet'
          )::int AS incomplete_device_records,
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM repair_photos rp
              WHERE rp.repair_ticket_id = rt.repair_ticket_id AND rp.photo_type = 'before'
            )
          )::int AS missing_before_photos,
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM repair_photos rp
              WHERE rp.repair_ticket_id = rt.repair_ticket_id AND rp.photo_type = 'after'
            )
          )::int AS missing_after_photos,
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM warranty_acceptances wa
              WHERE wa.repair_ticket_id = rt.repair_ticket_id
            )
          )::int AS missing_warranties,
          COUNT(*) FILTER (
            WHERE NOT EXISTS (
              SELECT 1 FROM payments p
              WHERE p.repair_ticket_id = rt.repair_ticket_id
            )
          )::int AS missing_payments,
          (
            SELECT COUNT(*)::int
            FROM payments p
            WHERE p.payment_status IS NOT NULL
              AND LOWER(p.payment_status) NOT IN ('paid', 'pending', 'failed', 'approved_not_completed')
          ) AS nonstandard_payment_statuses,
          (SELECT COUNT(*)::int FROM square_events_cleaned) AS cleaned_square_events,
          (SELECT COUNT(*)::int FROM repair_photos) AS photo_records,
          (SELECT COUNT(*)::int FROM technician_notes) AS technician_note_records
        FROM repair_tickets rt
        LEFT JOIN devices d ON d.device_id = rt.device_id
        WHERE rt.status <> 'deleted_from_web_app'`,
      ),
      pool.query(
        `SELECT
          rt.repair_ticket_id,
          c.display_name,
          d.device_model,
          rt.status AS repair_status,
          COALESCE(latest_payment.payment_status, 'missing_payment') AS payment_status,
          EXISTS (
            SELECT 1 FROM repair_photos rp
            WHERE rp.repair_ticket_id = rt.repair_ticket_id AND rp.photo_type = 'before'
          ) AS has_before_photo,
          EXISTS (
            SELECT 1 FROM repair_photos rp
            WHERE rp.repair_ticket_id = rt.repair_ticket_id AND rp.photo_type = 'after'
          ) AS has_after_photo,
          EXISTS (
            SELECT 1 FROM warranty_acceptances wa
            WHERE wa.repair_ticket_id = rt.repair_ticket_id
          ) AS has_warranty,
          latest_payment.payment_id IS NOT NULL AS has_payment
        FROM repair_tickets rt
        JOIN customers c ON c.customer_id = rt.customer_id
        JOIN devices d ON d.device_id = rt.device_id
        LEFT JOIN LATERAL (
          SELECT payment_id, payment_status
          FROM payments p
          WHERE p.repair_ticket_id = rt.repair_ticket_id
          ORDER BY p.last_updated_at DESC NULLS LAST, p.payment_id DESC
          LIMIT 1
        ) latest_payment ON TRUE
        WHERE rt.status <> 'deleted_from_web_app'
        ORDER BY rt.updated_at DESC NULLS LAST, rt.repair_ticket_id DESC
        LIMIT 10`,
      ),
    ]);

    return NextResponse.json(
      {
      connected: true,
      summary: summaryResult.rows[0] ?? null,
      repairs: repairsResult.rows,
      paymentStatus: paymentStatusResult.rows,
      repairStatus: repairStatusResult.rows,
      deviceFamilies: deviceFamilyResult.rows,
      warrantyCoverage: warrantyCoverageResult.rows[0] ?? null,
      dataCleaning: dataCleaningResult.rows[0] ?? null,
      documentationGaps: documentationGapResult.rows,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        connected: false,
        reason: error instanceof Error ? error.message : "Database query failed.",
        summary: null,
        repairs: [],
        paymentStatus: [],
        repairStatus: [],
        deviceFamilies: [],
        warrantyCoverage: null,
      },
      { status: 500 },
    );
  }
}
