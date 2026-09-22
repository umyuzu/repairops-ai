"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./page.module.css";

type Summary = {
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

type RepairRow = {
  repair_ticket_id: string;
  display_name: string;
  device_model: string;
  repair_type: string;
  repair_status: string;
  risk_level: string;
  estimate_amount: string;
  payment_amount: string | null;
  payment_status: string | null;
  needs_review: boolean | null;
};

type CountRow = {
  repair_count: number;
  estimated_value?: string;
  total_amount?: string;
  repair_status?: string;
  payment_status?: string;
  device_family?: string;
};

type WarrantyCoverage = {
  total_repairs: number;
  warranty_records: number;
  missing_warranty_records: number;
};

type DataCleaningSummary = {
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

type DocumentationGapRow = {
  repair_ticket_id: string;
  display_name: string;
  device_model: string;
  repair_status: string;
  payment_status: string;
  has_before_photo: boolean;
  has_after_photo: boolean;
  has_warranty: boolean;
  has_payment: boolean;
};

type DashboardResponse = {
  connected: boolean;
  reason?: string;
  summary: Summary | null;
  repairs: RepairRow[];
  paymentStatus: CountRow[];
  repairStatus: CountRow[];
  deviceFamilies: CountRow[];
  warrantyCoverage: WarrantyCoverage | null;
  dataCleaning?: DataCleaningSummary | null;
  documentationGaps?: DocumentationGapRow[];
};

const emptyData: DashboardResponse = {
  connected: false,
  summary: null,
  repairs: [],
  paymentStatus: [],
  repairStatus: [],
  deviceFamilies: [],
  warrantyCoverage: null,
  dataCleaning: null,
  documentationGaps: [],
};

function money(value: string | number | null | undefined) {
  const amount = Number(value ?? 0);
  return `$${amount.toFixed(2)}`;
}

function label(value: string | null | undefined) {
  if (!value) return "Missing";
  return value.replaceAll("_", " ");
}

export default function DataDashboardPage() {
  const [data, setData] = useState<DashboardResponse>(emptyData);
  const [isLoading, setIsLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState("");

  async function loadDashboard() {
    setIsLoading(true);
    try {
      const response = await fetch("/api/database-summary", { cache: "no-store" });
      const payload = (await response.json()) as DashboardResponse;
      setData(payload);
      setLastLoaded(new Date().toLocaleString());
    } catch {
      setData({ ...emptyData, reason: "Dashboard request failed." });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    let isMounted = true;

    async function loadInitialDashboard() {
      try {
        const response = await fetch("/api/database-summary", { cache: "no-store" });
        const payload = (await response.json()) as DashboardResponse;
        if (!isMounted) return;
        setData(payload);
        setLastLoaded(new Date().toLocaleString());
      } catch {
        if (!isMounted) return;
        setData({ ...emptyData, reason: "Dashboard request failed." });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void loadInitialDashboard();

    return () => {
      isMounted = false;
    };
  }, []);

  const summaryCards = useMemo(
    () => [
      ["Total repairs", data.summary?.total_repairs ?? "-"],
      ["Active repairs", data.summary?.active_repairs ?? "-"],
      ["Estimated value", money(data.summary?.estimated_repair_value)],
      ["Paid revenue", money(data.summary?.paid_revenue)],
      ["Pending payments", data.summary?.pending_payments ?? "-"],
      ["High risk", data.summary?.high_risk_repairs ?? "-"],
    ],
    [data.summary],
  );

  const cleaningCards = useMemo(
    () => [
      ["Tickets checked", data.dataCleaning?.total_tickets ?? "-"],
      ["Missing before photos", data.dataCleaning?.missing_before_photos ?? "-"],
      ["Missing after photos", data.dataCleaning?.missing_after_photos ?? "-"],
      ["Missing warranties", data.dataCleaning?.missing_warranties ?? "-"],
      ["Missing payments", data.dataCleaning?.missing_payments ?? "-"],
      ["Cleaned Square events", data.dataCleaning?.cleaned_square_events ?? "-"],
    ],
    [data.dataCleaning],
  );

  const documentationGaps = data.documentationGaps ?? [];

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerBrand}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.logo} src="/tnf-logo-visible.png" alt="Talk N Fix" />
          <div>
            <p>Independent Study Data Platform</p>
            <h1>Repair Operations Data Dashboard</h1>
            <span>Cloud PostgreSQL records, data cleaning checks, Square-style payment ETL evidence, and repair operation quality control.</span>
          </div>
        </div>
        <button type="button" onClick={() => void loadDashboard()} disabled={isLoading}>
          {isLoading ? "Loading..." : "Refresh Data"}
        </button>
      </header>

      <section className={styles.statusBand}>
        <div>
          <span>Database status</span>
          <strong>{data.connected ? "Connected to Supabase PostgreSQL" : "Database unavailable"}</strong>
        </div>
        <div>
          <span>Last loaded</span>
          <strong>{lastLoaded || "Waiting"}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>Next.js API route · PostgreSQL views</strong>
        </div>
      </section>

      {!data.connected ? <p className={styles.errorBox}>{data.reason || "No database response was returned."}</p> : null}

      <section className={styles.metricsGrid} aria-label="Database summary metrics">
        {summaryCards.map(([name, value]) => (
          <article className={styles.metricCard} key={name}>
            <span>{name}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className={styles.cleaningPanel}>
        <div className={styles.panelHeader}>
          <div>
            <p>Data Cleaning Workbench</p>
            <h2>Record Quality and ETL Checks</h2>
          </div>
          <span>{data.dataCleaning?.nonstandard_payment_statuses ?? 0} status issues</span>
        </div>
        <div className={styles.cleaningGrid}>
          {cleaningCards.map(([name, value]) => (
            <div className={styles.cleaningCard} key={name}>
              <span>{name}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Device</th>
                <th>Status</th>
                <th>Before</th>
                <th>After</th>
                <th>Warranty</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {documentationGaps.map((repair) => (
                <tr key={repair.repair_ticket_id}>
                  <td>
                    <strong>{repair.repair_ticket_id}</strong>
                    <span>{repair.display_name}</span>
                  </td>
                  <td>{repair.device_model}</td>
                  <td>{label(repair.repair_status)}</td>
                  <td className={repair.has_before_photo ? styles.cleanOk : styles.cleanMissing}>
                    {repair.has_before_photo ? "clean" : "missing"}
                  </td>
                  <td className={repair.has_after_photo ? styles.cleanOk : styles.cleanMissing}>
                    {repair.has_after_photo ? "clean" : "missing"}
                  </td>
                  <td className={repair.has_warranty ? styles.cleanOk : styles.cleanMissing}>
                    {repair.has_warranty ? "clean" : "missing"}
                  </td>
                  <td className={repair.has_payment ? styles.cleanOk : styles.cleanMissing}>
                    {repair.has_payment ? label(repair.payment_status) : "missing"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.dashboardGrid}>
        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Analytics View</p>
              <h2>Repair Status Summary</h2>
            </div>
            <span>{data.repairStatus.length} rows</span>
          </div>
          <div className={styles.list}>
            {data.repairStatus.map((row) => (
              <div className={styles.listRow} key={row.repair_status}>
                <span>{label(row.repair_status)}</span>
                <strong>{row.repair_count}</strong>
                <em>{money(row.estimated_value)}</em>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Analytics View</p>
              <h2>Payment Status Summary</h2>
            </div>
            <span>{data.paymentStatus.length} rows</span>
          </div>
          <div className={styles.list}>
            {data.paymentStatus.map((row) => (
              <div className={styles.listRow} key={row.payment_status}>
                <span>{label(row.payment_status)}</span>
                <strong>{row.repair_count}</strong>
                <em>{money(row.total_amount)}</em>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Analytics View</p>
              <h2>Device Family Breakdown</h2>
            </div>
            <span>{data.deviceFamilies.length} rows</span>
          </div>
          <div className={styles.list}>
            {data.deviceFamilies.map((row) => (
              <div className={styles.listRow} key={row.device_family}>
                <span>{label(row.device_family)}</span>
                <strong>{row.repair_count}</strong>
                <em>{money(row.estimated_value)}</em>
              </div>
            ))}
          </div>
        </article>

        <article className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <p>Documentation Check</p>
              <h2>Warranty Coverage</h2>
            </div>
          </div>
          <div className={styles.coverageBox}>
            <div>
              <span>Total repairs</span>
              <strong>{data.warrantyCoverage?.total_repairs ?? "-"}</strong>
            </div>
            <div>
              <span>Warranty records</span>
              <strong>{data.warrantyCoverage?.warranty_records ?? "-"}</strong>
            </div>
            <div>
              <span>Missing warranty records</span>
              <strong>{data.warrantyCoverage?.missing_warranty_records ?? "-"}</strong>
            </div>
          </div>
        </article>
      </section>

      <section className={styles.tablePanel}>
        <div className={styles.panelHeader}>
          <div>
            <p>Cloud PostgreSQL Records</p>
            <h2>Recent Repair and Payment Records</h2>
          </div>
          <span>{data.repairs.length} records loaded</span>
        </div>
        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Device</th>
                <th>Repair Status</th>
                <th>Risk</th>
                <th>Estimate</th>
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {data.repairs.map((repair) => (
                <tr key={repair.repair_ticket_id}>
                  <td>
                    <strong>{repair.repair_ticket_id}</strong>
                    <span>{repair.display_name}</span>
                  </td>
                  <td>{repair.device_model}</td>
                  <td>{label(repair.repair_status)}</td>
                  <td>{label(repair.risk_level)}</td>
                  <td>{money(repair.estimate_amount)}</td>
                  <td>{label(repair.payment_status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.pipeline}>
        <div>
          <p>Project Data Pipeline</p>
          <h2>ETL and Data Cleaning Direction</h2>
        </div>
        <ol>
          <li>Collect Square-style raw payment events and repair records.</li>
          <li>Clean status values, missing proof fields, amounts, timestamps, and repair categories.</li>
          <li>Load structured records into PostgreSQL summary views.</li>
          <li>Use quality checks to identify missing warranty records, missing payment links, and incomplete repair proof.</li>
        </ol>
      </section>
    </main>
  );
}
