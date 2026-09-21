import { NextResponse } from "next/server";
import { getPool } from "@/lib/postgres";

export const runtime = "nodejs";

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
    ]);

    return NextResponse.json({
      connected: true,
      summary: summaryResult.rows[0] ?? null,
      repairs: repairsResult.rows,
      paymentStatus: paymentStatusResult.rows,
      repairStatus: repairStatusResult.rows,
      deviceFamilies: deviceFamilyResult.rows,
      warrantyCoverage: warrantyCoverageResult.rows[0] ?? null,
    });
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
