import {
  type TriggerEventAction,
  jsonSchemaNullable,
  InternalServerError,
} from "@langfuse/shared";
import {
  getTriggerConfigurations,
  getActionById,
  logger,
  WebhookQueue,
  QueueName,
  QueueJobs,
  InMemoryFilterService,
  getAutomations,
  EntityChangeEventType,
} from "@langfuse/shared/src/server";
import { TriggerEventSource } from "@langfuse/shared";
import { ActionExecutionStatus, JobConfigState } from "@langfuse/shared";
import { prisma } from "@langfuse/shared/src/db";
import { v4 } from "uuid";
import type { DatasetDomain } from "@langfuse/shared";

/**
 * Process dataset change events with in-memory filtering
 */
export const datasetVersionProcessor = async (
  event: Extract<EntityChangeEventType, { entityType: "dataset" }>,
): Promise<void> => {
  try {
    logger.info(
      `Processing dataset change event for dataset ${event.datasetId} for project ${event.projectId}`,
      { event: JSON.stringify(event, null, 2) },
    );

    // Get active dataset triggers
    const triggers = await getTriggerConfigurations({
      projectId: event.projectId,
      eventSource: TriggerEventSource.Dataset,
      status: JobConfigState.ACTIVE,
    });

    logger.debug(`Found ${triggers.length} active dataset triggers`, {
      datasetId: event.datasetId,
      projectId: event.projectId,
      action: event.action,
    });

    // Process each trigger
    for (const trigger of triggers) {
      try {
        // Create a unified data object that includes both dataset data and the action
        const eventData = {
          ...event.dataset,
          action: event.action,
        };

        // Create a field mapper for all data including action
        const fieldMapper = (data: typeof eventData, column: string) => {
          switch (column) {
            case "action":
              return data.action;
            case "Name":
              return data.name;
            default:
              return undefined;
          }
        };

        // Use InMemoryFilterService for all filtering including actions
        const eventMatches = InMemoryFilterService.evaluateFilter(
          eventData,
          trigger.filter,
          fieldMapper,
        );

        if (!eventMatches) {
          logger.debug(`Event doesn't match trigger ${trigger.id} filters`, {
            datasetId: event.datasetId,
            projectId: event.projectId,
            action: event.action,
          });
          continue;
        }

        logger.debug(`Trigger ${trigger.id} matches, executing actions`, {
          datasetId: event.datasetId,
          projectId: event.projectId,
          action: event.action,
        });

        if (trigger.actionIds.length !== 1) {
          logger.debug(
            `Trigger ${trigger.id} for project ${trigger.projectId} has multiple or no actions. This is not expected`,
          );
          throw new InternalServerError(
            `Trigger ${trigger.id} for project ${trigger.projectId} has multiple or no actions. This is not expected`,
          );
        }

        await Promise.all(
          trigger.actionIds.map(async (actionId) => {
            const actionConfig = await getActionById({
              projectId: event.projectId,
              actionId,
            });

            if (!actionConfig) {
              logger.error(`Action ${actionId} not found`);
              return;
            }

            await enqueueAutomationAction({
              datasetData: event.dataset,
              action: event.action,
              triggerId: trigger.id,
              actionId,
              projectId: event.projectId,
            });
          }),
        );
      } catch (error) {
        logger.error(
          `Error processing trigger ${trigger.id} for dataset ${event.datasetId} for project ${event.projectId}: ${error}`,
        );
        // Continue processing other triggers instead of failing the entire operation
      }
    }
  } catch (error) {
    logger.error(
      `Failed to process dataset change event for dataset ${event.datasetId} for project ${event.projectId}: ${error}`,
    );
    throw error; // Re-throw to trigger retry mechanism
  }
};

/**
 * Enqueue an automation action for a dataset change.
 * Only webhook actions are supported for dataset events.
 */
async function enqueueAutomationAction({
  datasetData,
  action,
  triggerId,
  actionId,
  projectId,
}: {
  datasetData: DatasetDomain;
  action: string;
  triggerId: string;
  actionId: string;
  projectId: string;
}): Promise<void> {
  // Get automations for this action
  const automations = await getAutomations({
    projectId,
    actionId,
  });

  if (automations.length !== 1) {
    throw new InternalServerError(
      `Expected 1 automation for action ${actionId}, got ${automations.length}`,
    );
  }

  const executionId = v4();

  // Create execution record
  await prisma.automationExecution.create({
    data: {
      id: executionId,
      projectId,
      automationId: automations[0].id,
      triggerId,
      actionId,
      status: ActionExecutionStatus.PENDING,
      sourceId: datasetData.id,
      input: {
        datasetName: datasetData.name,
        datasetId: datasetData.id,
        automationId: automations[0].id,
        type: "dataset",
      },
    },
  });

  logger.debug(
    `Created automation execution ${executionId} for project ${projectId} and action ${actionId}`,
  );

  // Queue to webhook processor (only webhook actions supported for dataset events)
  await WebhookQueue.getInstance()?.add(QueueName.WebhookQueue, {
    timestamp: new Date(),
    id: v4(),
    payload: {
      projectId,
      automationId: automations[0].id,
      executionId,
      payload: {
        action: action as TriggerEventAction,
        type: "dataset",
        dataset: {
          ...datasetData,
          metadata: jsonSchemaNullable.parse(datasetData.metadata),
          inputSchema: jsonSchemaNullable.parse(datasetData.inputSchema),
          expectedOutputSchema: jsonSchemaNullable.parse(
            datasetData.expectedOutputSchema,
          ),
        },
      },
    },
    name: QueueJobs.WebhookJob,
  });
}
