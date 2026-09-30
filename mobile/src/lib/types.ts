export type Kind = 'expense' | 'income';
export type Mode = 'system' | 'light' | 'dark';

export type User = {
  id: number;
  name: string;
  first_name: string;
  email: string;
  currency: string;
  theme: string;
  mode: Mode;
  accent: string | null;
  monthly_budget_cents: number;
  email_verified: boolean;
  auto_save_receipts: boolean;
  created_at: string;
};

export type Transaction = {
  id: number;
  kind: Kind;
  amount_cents: number;
  category: string;
  date: string;
  description: string;
  reference: string | null;
  recurring: boolean;
};

export type Totals = { income: number; expense: number; net: number; expense_count: number; savings_rate: number | null };
export type CategoryTotal = { category: string; total: number; count: number; share: number };
export type MonthPoint = { key: string; label: string; income: number; expense: number; net: number };
export type Insight = { tone: 'good' | 'warning' | 'critical' | 'info'; text: string };
export type Status = 'good' | 'warning' | 'critical';
export type BudgetLine = { category?: string; budget: number; spent: number; remaining: number; percent: number; status: Status };
export type BudgetStatus = { overall: BudgetLine | null; categories: BudgetLine[]; total_spent: number };

export type Goal = {
  id: number;
  name: string;
  target_cents: number;
  saved_cents: number;
  target_date: string | null;
  percent: number;
  remaining_cents: number;
  months_left: number | null;
  monthly_needed_cents: number | null;
  status: 'open' | 'scheduled' | 'overdue' | 'complete';
};

export type Rule = {
  id: number;
  kind: Kind;
  amount_cents: number;
  category: string;
  description: string;
  frequency: 'weekly' | 'monthly' | 'yearly';
  next_date: string;
  active: boolean;
};

export type Dashboard = {
  month_name: string;
  today: string;
  has_any: boolean;
  this_month: Totals;
  last_month: Totals;
  categories: CategoryTotal[];
  budget: BudgetStatus;
  recent: Transaction[];
  goals: Goal[];
  insights: Insight[];
  trend: MonthPoint[];
  pace: { days_in_month: number; this_month: number[]; last_month: number[]; budget: number };
};

export type QuickPreview = {
  ok: boolean;
  error?: string;
  when?: string;
  kind?: Kind;
  amount?: string;
  category?: string;
  date?: string;
  is_today?: boolean;
  description?: string;
};
