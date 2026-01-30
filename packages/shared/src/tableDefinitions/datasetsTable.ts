import { ColumnDefinition } from "./index";

// Simple column definitions for dataset filtering in automations
// Note: The 'internal' property is required by ColumnDefinition type but not used
// for in-memory filtering in automations (which uses InMemoryFilterService)
export const datasetsTableCols: ColumnDefinition[] = [
  {
    id: "name",
    name: "Name",
    type: "string",
    internal: 'd."name"', // Placeholder - not used for in-memory filtering
  },
];

export function datasetActionFilterOptions(): ColumnDefinition[] {
  return datasetsTableCols.filter((col) => col.id === "name");
}
