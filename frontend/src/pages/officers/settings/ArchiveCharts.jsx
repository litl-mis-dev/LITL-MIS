import {
    PieChart, Pie, Cell, BarChart, Bar, Rectangle, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";

// History ▸ Archive: the selected semester's figures as charts. Everything
// comes from the archive summary the page already loads, so the charts change
// with the academic year and semester filters.

// Colors carry the meaning they have across LITL MIS: orange = money
// collected, red = money out (disbursed) or unpaid, green = money back or
// paid, amber = settled. Shades are picked to pass the colorblind-safety
// check, and every value is also written as text, so no reading depends on
// color alone. The Dashboard's fund chart uses the same money colors.
const FLOW_COLORS = { collections: "#ef8315", disbursements: "#b91c1c", returned: "#22c55e" };
// Each bar is also named on its axis and shows its value. Active is the
// neutral total (blue); the rest match the Paid / Unpaid / Settled badges.
const BALANCE_COLORS = { Beginning: "#2563eb", Ending: "#ef8315" };
const MEMBER_COLORS = { Active: "#2563eb", Paid: "#16a34a", Unpaid: "#b91c1c", Settled: "#d97706" };

const TOOLTIP_STYLE = {
    fontSize: 13,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    border: "1px solid #e2e8f0",
    boxShadow: "0 8px 20px rgba(0, 0, 0, 0.08)",
};
const AXIS_TICK = { fontSize: 12, fill: "#64748b" };

const peso = (value) => {
    const n = Number(value) || 0;
    return `${n < 0 ? "-" : ""}₱${Math.abs(n).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const compactPeso = (value) => `₱${Number(value).toLocaleString("en-PH", { notation: "compact", maximumFractionDigits: 1 })}`;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Each bar is drawn with its value: recharts skips labels on zero-length
// bars, and a zero ("Unpaid 0", "₱0.00") is worth reading too.
const VALUE_LABEL = { fontSize: 12, fontWeight: 700, fill: "#26313d" };
const barWithValueAbove = (format) => function BarWithValueAbove(props) {
    const { x, y, width, value } = props;
    return (
        <g>
            <Rectangle {...props} />
            <text x={x + width / 2} y={y - 8} textAnchor="middle" style={VALUE_LABEL}>{format(value)}</text>
        </g>
    );
};
const barWithValueRight = (format) => function BarWithValueRight(props) {
    const { x, y, width, height, value } = props;
    return (
        <g>
            <Rectangle {...props} />
            <text x={x + width + 8} y={y + height / 2} dominantBaseline="central" style={VALUE_LABEL}>{format(value)}</text>
        </g>
    );
};

function prefersReducedMotion() {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export default function ArchiveCharts({ summary, counts, members, membersNote }) {
    const animate = !prefersReducedMotion();
    return (
        <div className="archive-charts" aria-label="Financial summary">
            <MoneyFlowChart summary={summary} counts={counts} animate={animate} />
            <BalanceChart summary={summary} animate={animate} />
            <MembersChart members={members} note={membersNote} animate={animate} />
        </div>
    );
}

function ChartCard({ title, subtitle, children }) {
    return (
        <section className="archive-chart">
            <h4 className="archive-chart__title">{title}</h4>
            {subtitle && <p className="archive-chart__sub">{subtitle}</p>}
            {children}
        </section>
    );
}

// Part-to-whole of the money that moved, as one pie.
function MoneyFlowChart({ summary, counts, animate }) {
    const flows = [
        { key: "collections", label: "Membership Collections", value: Number(summary.totalMembershipCollections) || 0, note: plural(counts.payments, "payment") },
        { key: "disbursements", label: "Disbursements", value: Number(summary.totalDisbursements) || 0, note: plural(counts.disbursements, "record") },
        { key: "returned", label: "Returned Funds", value: Number(summary.totalReturnedFunds) || 0, note: plural(counts.returnFunds, "record") },
    ];
    const total = flows.reduce((sum, flow) => sum + flow.value, 0);
    const share = (value) => (total ? `${Math.round((value / total) * 100)}%` : "0%");

    return (
        <ChartCard title="Money in and out" subtitle="Collections exclude the turnover carried over.">
            {total > 0 ? (
                <ResponsiveContainer width="100%" height={200}>
                    <PieChart>
                        <Pie data={flows.filter((flow) => flow.value > 0)} dataKey="value" nameKey="label" outerRadius={80}
                            stroke="#ffffff" strokeWidth={2} isAnimationActive={animate}>
                            {flows.filter((flow) => flow.value > 0).map((flow) => <Cell key={flow.key} fill={FLOW_COLORS[flow.key]} />)}
                        </Pie>
                        <Tooltip formatter={(value, name) => [`${peso(value)} (${share(value)})`, name]} contentStyle={TOOLTIP_STYLE} />
                    </PieChart>
                </ResponsiveContainer>
            ) : (
                <p className="archive-chart__empty">No money was collected, disbursed or returned this semester.</p>
            )}
            <ul className="archive-chart__legend">
                {flows.map((flow) => (
                    <li key={flow.key}>
                        <span className="archive-chart__swatch" style={{ background: FLOW_COLORS[flow.key] }} aria-hidden="true" />
                        <span className="archive-chart__legend-label">{flow.label}<small>{flow.note}</small></span>
                        <span className="archive-chart__legend-value">{peso(flow.value)}<small>{share(flow.value)}</small></span>
                    </li>
                ))}
            </ul>
        </ChartCard>
    );
}

// How the fund stood at the start and at the end of the semester.
function BalanceChart({ summary, animate }) {
    const data = [
        { label: "Beginning", value: Number(summary.beginningBalance) || 0 },
        { label: "Ending", value: Number(summary.endingBalance) || 0 },
    ];
    return (
        <ChartCard title="Fund balance" subtitle="The beginning balance is carried over from the previous semester.">
            <ResponsiveContainer width="100%" height={232}>
                <BarChart data={data} margin={{ top: 24, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} />
                    <YAxis tick={AXIS_TICK} axisLine={false} tickLine={false} tickFormatter={compactPeso} width={56} allowDecimals={false} />
                    <Tooltip formatter={(value) => [peso(value), "Balance"]} labelFormatter={(label) => `${label} balance`}
                        cursor={{ fill: "#f8fafc" }} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]} maxBarSize={56} isAnimationActive={animate} shape={barWithValueAbove(peso)}>
                        {data.map((bar) => <Cell key={bar.label} fill={BALANCE_COLORS[bar.label]} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </ChartCard>
    );
}

// Member counts for the semester, compared side by side.
function MembersChart({ members, note, animate }) {
    const rows = [
        { label: "Active", value: members?.totalActive },
        { label: "Paid", value: members?.totalPaid },
        { label: "Unpaid", value: members?.totalUnpaid },
        { label: "Settled", value: members?.totalSettled },
    ];
    const recorded = rows.every((row) => row.value !== null && row.value !== undefined);
    const when = { "current members": "Live count of current members. ", "at semester close": "Counted when the semester closed. " }[note] ?? "";
    const subtitle = `${when}Settled members paid earlier semesters' fees.`;

    return (
        <ChartCard title="Members" subtitle={subtitle}>
            {recorded ? (
                <ResponsiveContainer width="100%" height={232}>
                    <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 40, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={AXIS_TICK} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="label" tick={AXIS_TICK} axisLine={false} tickLine={false} width={64} />
                        <Tooltip formatter={(value) => [plural(value, "member"), "Members"]} cursor={{ fill: "#f8fafc" }} contentStyle={TOOLTIP_STYLE} />
                        <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={28} isAnimationActive={animate} shape={barWithValueRight(String)}>
                            {rows.map((row) => <Cell key={row.label} fill={MEMBER_COLORS[row.label]} />)}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            ) : (
                <p className="archive-chart__empty">Member counts were not recorded for this semester.</p>
            )}
        </ChartCard>
    );
}
