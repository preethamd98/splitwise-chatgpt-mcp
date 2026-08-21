type JsonRecord = Record<string, unknown>;

export type PageInput = { limit: number; offset: number };

const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown) => typeof value === "string" ? value : undefined;
const number = (value: unknown) => typeof value === "number" ? value : undefined;

function defined(entries: Array<[string, unknown]>) {
  return Object.fromEntries(entries.filter(([, value]) => value !== undefined && value !== null));
}

function name(value: unknown) {
  const item = record(value);
  return [text(item.first_name), text(item.last_name)].filter(Boolean).join(" ") || undefined;
}

function balances(value: unknown) {
  return array(value).map((entry) => {
    const balance = record(entry);
    return defined([["amount", text(balance.amount)], ["currency_code", text(balance.currency_code)]]);
  }).filter((entry) => entry.amount !== undefined && entry.amount !== "0" && entry.amount !== "0.0" && entry.amount !== "0.00");
}

function participant(value: unknown) {
  const item = record(value);
  const user = record(item.user);
  return defined([
    ["id", number(user.id)],
    ["name", name(user)],
    ["paid_share", text(item.paid_share)],
    ["owed_share", text(item.owed_share)],
    ["net_balance", text(item.net_balance)],
  ]);
}

function expenseSummary(value: unknown) {
  const item = record(value);
  const category = record(item.category);
  const createdBy = record(item.created_by);
  return defined([
    ["id", number(item.id)],
    ["group_id", number(item.group_id)],
    ["description", text(item.description)],
    ["cost", text(item.cost)],
    ["currency_code", text(item.currency_code)],
    ["date", text(item.date)],
    ["updated_at", text(item.updated_at)],
    ["deleted_at", text(item.deleted_at)],
    ["payment", typeof item.payment === "boolean" ? item.payment : undefined],
    ["category", category.id || category.name ? defined([["id", number(category.id)], ["name", text(category.name)]]) : undefined],
    ["created_by", createdBy.id ? defined([["id", number(createdBy.id)], ["name", name(createdBy)]]) : undefined],
    ["participants", array(item.users).map(participant)],
  ]);
}

function pagination(page: PageInput, returned: number, total?: number) {
  const hasMore = total === undefined ? returned === page.limit : page.offset + returned < total;
  return defined([
    ["limit", page.limit],
    ["offset", page.offset],
    ["returned", returned],
    ["total", total],
    ["has_more", hasMore],
    ["next_offset", hasMore ? page.offset + returned : undefined],
  ]);
}

export function summarizeGroups(response: unknown, page: PageInput) {
  const groups = array(record(response).groups);
  const selected = groups.slice(page.offset, page.offset + page.limit).map((value) => {
    const item = record(value);
    return defined([
      ["id", number(item.id)],
      ["name", text(item.name)],
      ["group_type", text(item.group_type)],
      ["updated_at", text(item.updated_at)],
      ["simplify_by_default", typeof item.simplify_by_default === "boolean" ? item.simplify_by_default : undefined],
      ["members", array(item.members).map((memberValue) => {
        const member = record(memberValue);
        return defined([["id", number(member.id)], ["name", name(member)], ["balances", balances(member.balance)]]);
      })],
    ]);
  });
  return { groups: selected, pagination: pagination(page, selected.length, groups.length) };
}

export function summarizeFriends(response: unknown, page: PageInput) {
  const friends = array(record(response).friends);
  const selected = friends.slice(page.offset, page.offset + page.limit).map((value) => {
    const item = record(value);
    const groupBalances = array(item.groups).map((groupValue) => {
      const group = record(groupValue);
      return defined([["group_id", number(group.group_id)], ["balances", balances(group.balance)]]);
    }).filter((group) => Array.isArray(group.balances) && group.balances.length > 0);
    return defined([
      ["id", number(item.id)],
      ["name", name(item)],
      ["registration_status", text(item.registration_status)],
      ["balances", balances(item.balance)],
      ["group_balances", groupBalances],
      ["updated_at", text(item.updated_at)],
    ]);
  });
  return { friends: selected, pagination: pagination(page, selected.length, friends.length) };
}

export function summarizeExpenses(response: unknown, page: PageInput) {
  const expenses = array(record(response).expenses).map(expenseSummary);
  return { expenses, pagination: pagination(page, expenses.length) };
}

export function summarizeExpenseDetails(response: unknown) {
  const root = record(response);
  const rawExpense = array(root.expenses)[0];
  if (!rawExpense) return { expense: null };
  const item = record(rawExpense);
  const base = expenseSummary(item);
  const comments = array(item.comments).map((commentValue) => {
    const comment = record(commentValue);
    const user = record(comment.user);
    return defined([
      ["id", number(comment.id)],
      ["content", text(comment.content)],
      ["created_at", text(comment.created_at)],
      ["user", user.id ? defined([["id", number(user.id)], ["name", name(user)]]) : undefined],
    ]);
  });
  const repayments = array(item.repayments).map((repaymentValue) => {
    const repayment = record(repaymentValue);
    return defined([
      ["from", number(repayment.from)],
      ["to", number(repayment.to)],
      ["amount", text(repayment.amount)],
    ]);
  });
  return { expense: { ...base, ...defined([["details", text(item.details)], ["repayments", repayments], ["comments", comments]]) } };
}
