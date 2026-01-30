import { z } from "zod/v4";
import { jsonSchemaNullable } from "../utils/zod";

export const DatasetDomainSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectId: z.string(),
  description: z.string().nullable(),
  metadata: jsonSchemaNullable,
  remoteExperimentUrl: z.string().nullable(),
  remoteExperimentPayload: jsonSchemaNullable,
  inputSchema: jsonSchemaNullable,
  expectedOutputSchema: jsonSchemaNullable,
  itemsUpdatedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

export type DatasetDomain = z.infer<typeof DatasetDomainSchema>;
