const knownTools = new Set(["list_groups", "list_friends", "list_expenses", "get_expense", "create_expense", "update_expense"]);

export function normalizeToolName(name: string) {
  if (knownTools.has(name)) return name;
  const candidate = /^(?:splitwise|splitwise[_ -]stateless)\.([a-z_]+)$/i.exec(name)?.[1];
  return candidate && knownTools.has(candidate) ? candidate : name;
}
