import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaidCount, PayChanges, paidCount, payChangeReason, payChanges } from "./round32";

const slip = (id, netPay, previousNetPay, paymentStatus = "UNPAID") => ({ id, employeeId: id, netPay, previousNetPay, paymentStatus });

describe("payChangeReason", () => {
  it("names this month's inputs", () => {
    expect(payChangeReason(slip("a", 1, 2), { lwpDays: 2, overtimeAmount: 0 })).toBe("2 days unpaid");
    expect(payChangeReason(slip("a", 1, 2), { lwpDays: 1, overtimeAmount: 2400 })).toBe("1 day unpaid · Overtime ₹2,400.00");
    expect(payChangeReason(slip("a", 1, 2), { variablePay: 5000 })).toBe("Variable pay ₹5,000.00");
  });
  it("says first payslip, or a salary change when no input explains it", () => {
    expect(payChangeReason(slip("a", 1, null), null)).toBe("First payslip");
    expect(payChangeReason(slip("a", 1, 2), { lwpDays: 0 })).toBe("Salary or deductions changed");
  });
});

describe("payChanges", () => {
  it("keeps only moved take-home, biggest first", () => {
    const rows = payChanges([slip("a", 100, 100), slip("b", 52000, 48000), slip("c", 29900, 32000)]);
    expect(rows.map((r) => r.slip.id)).toEqual(["b", "c"]);
    expect(rows[1].change).toBe(-2100);
  });
});

describe("PayChanges", () => {
  it("lists people with change and reason", () => {
    const byEmployee = new Map([
      ["b", { employee: { name: "Priya N" }, input: {} }],
      ["c", { employee: { name: "Arun S" }, input: { lwpDays: 2 } }],
    ]);
    render(<PayChanges slips={[slip("b", 56000, 52000), slip("c", 29900, 32000)]} byEmployee={byEmployee} />);
    expect(screen.getByText(/Paid differently from last period · 2 people/)).toBeTruthy();
    expect(screen.getByText("+₹4,000.00")).toBeTruthy();
    expect(screen.getByText("−₹2,100.00")).toBeTruthy();
    expect(screen.getByText("2 days unpaid")).toBeTruthy();
  });
  it("says so when nobody moved", () => {
    render(<PayChanges slips={[slip("a", 100, 100)]} byEmployee={new Map()} />);
    expect(screen.getByText("Everyone is paid the same as last period.")).toBeTruthy();
  });
});

describe("PaidCount", () => {
  it("counts paid and failed", () => {
    expect(paidCount([slip("a", 1, 1, "PAID"), slip("b", 1, 1, "FAILED"), slip("c", 1, 1)])).toEqual({ total: 3, paid: 1, failed: 1 });
  });
  it("shows nothing before approval", () => {
    const { container } = render(<PaidCount slips={[slip("a", 1, 1)]} status="REVIEW" />);
    expect(container.textContent).toBe("");
  });
  it("gives one answer once approved", () => {
    const { rerender } = render(<PaidCount slips={[slip("a", 1, 1, "PAID"), slip("b", 1, 1, "FAILED")]} status="LOCKED" />);
    expect(screen.getByText("1 of 2 paid")).toBeTruthy();
    expect(screen.getByText("1 came back from the bank")).toBeTruthy();
    rerender(<PaidCount slips={[slip("a", 1, 1, "PAID")]} status="PAID" />);
    expect(screen.getByText("All 1 paid")).toBeTruthy();
    rerender(<PaidCount slips={[slip("a", 1, 1)]} status="APPROVED" />);
    expect(screen.getByText("Not paid yet")).toBeTruthy();
  });
});
