export type ExpenseFilters = {
  group_id?: number; friend_id?: number; dated_after?: string; dated_before?: string;
  updated_after?: string; updated_before?: string; limit?: number; offset?: number;
};

export type ExpenseShare = { user_id: number; paid_share: string; owed_share: string };
export type CreateExpenseInput = {
  cost: string; description: string; details?: string; date?: string; currency_code?: string;
  category_id?: number; group_id: number; split_equally?: boolean; shares?: ExpenseShare[];
};

export class SplitwiseClient {
  constructor(private readonly accessToken: string, private readonly apiBaseUrl: string) {}

  private async request(path: string, init?: RequestInit) {
    const response = await fetch(`${this.apiBaseUrl}/${path}`, {
      ...init,
      headers: { accept: "application/json", authorization: `Bearer ${this.accessToken}`, ...init?.headers },
    });
    const body = await response.json().catch(() => ({ error: response.statusText }));
    if (!response.ok) throw new Error(`Splitwise API ${response.status}: ${JSON.stringify(body)}`);
    return body;
  }

  listGroups() { return this.request("get_groups"); }
  listFriends() { return this.request("get_friends"); }
  getExpense(id: number) { return this.request(`get_expense/${id}`); }
  listExpenses(filters: ExpenseFilters) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) query.set(key, String(value));
    return this.request(`get_expenses${query.size ? `?${query}` : ""}`);
  }

  async createExpense(input: CreateExpenseInput) {
    const form = new URLSearchParams({ cost: input.cost, description: input.description, group_id: String(input.group_id) });
    for (const key of ["details", "date", "currency_code"] as const) if (input[key] !== undefined) form.set(key, String(input[key]));
    if (input.category_id !== undefined) form.set("category_id", String(input.category_id));
    if (input.split_equally) form.set("split_equally", "true");
    input.shares?.forEach((share, index) => {
      form.set(`users__${index}__user_id`, String(share.user_id));
      form.set(`users__${index}__paid_share`, share.paid_share);
      form.set(`users__${index}__owed_share`, share.owed_share);
    });
    const result = await this.request("create_expense", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    if (result && typeof result === "object" && "errors" in result) {
      const errors = (result as { errors?: unknown }).errors;
      if (errors && (Array.isArray(errors) ? errors.length : Object.keys(errors as object).length)) throw new Error(`Splitwise rejected expense: ${JSON.stringify(errors)}`);
    }
    return result;
  }
}
