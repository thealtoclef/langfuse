import { jsonSchemaNullable, type TriggerEventAction } from "@langfuse/shared";
import {
  logger,
  EntityChangeQueue,
  QueueJobs,
  QueueName,
  listDatasetVersions,
} from "@langfuse/shared/src/server";
import { v4 } from "uuid";
import type { DatasetDomain } from "@langfuse/shared";

/**
 * Queue dataset change events for async processing using the generic EntityChangeQueue
 */
export const datasetChangeEventSourcing = async (
  datasetData: DatasetDomain | null,
  action: TriggerEventAction,
) => {
  if (!datasetData) {
    return;
  }

  // Get the latest dataset item timestamp (latest validFrom timestamp from DatasetItems)
  const datasetVersions = await listDatasetVersions({
    projectId: datasetData.projectId,
    datasetId: datasetData.id,
  });
  const itemsUpdatedAt = datasetVersions.length > 0 ? datasetVersions[0] : null;

  const event = {
    timestamp: new Date(),
    id: v4(),
    name: QueueJobs.EntityChangeJob as QueueJobs.EntityChangeJob,
    payload: {
      entityType: "dataset" as const,
      projectId: datasetData.projectId,
      datasetId: datasetData.id,
      action: action,
      dataset: {
        ...datasetData,
        itemsUpdatedAt: itemsUpdatedAt,
        metadata: jsonSchemaNullable.parse(datasetData.metadata),
        inputSchema: jsonSchemaNullable.parse(datasetData.inputSchema),
        expectedOutputSchema: jsonSchemaNullable.parse(
          datasetData.expectedOutputSchema,
        ),
      },
    },
  };
  try {
    // Queue the entity change event for async processing
    await EntityChangeQueue.getInstance()?.add(
      QueueName.EntityChangeQueue,
      event,
    );

    logger.info(
      `Queued entity change event for dataset ${datasetData.id} in project ${datasetData.projectId} with action ${action}`,
    );
  } catch (error) {
    logger.error(
      `Failed to queue entity change event for dataset ${datasetData.id} for project ${datasetData.projectId}: ${error}`,
    );
    throw error;
  }
};
