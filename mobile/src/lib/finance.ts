// Mirrors services/finance.py (and the website's calculators.js).
// Rates are annual percentages compounded monthly; values are whole currency units.

const monthlyRate = (annual: number) => annual / 100 / 12;

export function futureValue(principal: number, monthly: number, annual: number, months: number) {
  const r = monthlyRate(annual);
  if (r === 0) return principal + monthly * months;
  const g = Math.pow(1 + r, months);
  return principal * g + (monthly * (g - 1)) / r;
}

export function requiredMonthly(target: number, current: number, annual: number, months: number) {
  if (months <= 0) return Math.max(target - current, 0);
  const r = monthlyRate(annual);
  let needed: number;
  if (r === 0) needed = (target - current) / months;
  else {
    const g = Math.pow(1 + r, months);
    needed = ((target - current * g) * r) / (g - 1);
  }
  return Math.max(needed, 0);
}

export function monthsToGoal(target: number, current: number, monthly: number, annual: number): number | null {
  if (current >= target) return 0;
  const r = monthlyRate(annual);
  if (r === 0) return monthly > 0 ? Math.ceil((target - current) / monthly) : null;
  if (monthly <= 0 && current <= 0) return null;
  const den = current * r + monthly;
  if (den <= 0) return null;
  const n = Math.ceil(Math.log((target * r + monthly) / den) / Math.log(1 + r) - 1e-9);
  return n <= 1200 ? n : null;
}

export function emi(principal: number, annual: number, months: number) {
  if (months <= 0) return NaN;
  const r = monthlyRate(annual);
  if (r === 0) return principal / months;
  const g = Math.pow(1 + r, months);
  return (principal * r * g) / (g - 1);
}

export function duration(months: number) {
  const y = Math.floor(months / 12), m = months % 12;
  const parts: string[] = [];
  if (y) parts.push(`${y} ${y === 1 ? 'year' : 'years'}`);
  if (m || !y) parts.push(`${m} ${m === 1 ? 'month' : 'months'}`);
  return parts.join(' ');
}
