import { ApplicationTaskKey, ApplicationTaskStatus, Prisma } from "@prisma/client";
import { prisma } from "../db";
import {
  APPLICATION_TASK_DEFINITIONS,
  ApplicationTaskKeyValue,
  deriveApplicationReadiness,
} from "./workflow-types";

interface InitializeWorkflowOptions {
  hasJobDescription?: boolean;
}

interface TaskMetadataOptions {
  metadata?: Prisma.InputJsonValue;
}

interface FailTaskOptions extends TaskMetadataOptions {
  code?: string;
}

function taskKey(key: ApplicationTaskKeyValue): ApplicationTaskKey {
  return key as ApplicationTaskKey;
}

export async function initializeApplicationWorkflow(
  applicationId: string,
  options: InitializeWorkflowOptions = {}
) {
  const now = new Date();
  await prisma.applicationTask.createMany({
    data: APPLICATION_TASK_DEFINITIONS.map((definition) => ({
      applicationId,
      key: taskKey(definition.key),
      required: definition.required,
      status:
        definition.key === "PARSE_JOB" && options.hasJobDescription
          ? ApplicationTaskStatus.SUCCESS
          : ApplicationTaskStatus.PENDING,
      completedAt: definition.key === "PARSE_JOB" && options.hasJobDescription ? now : null,
    })),
    skipDuplicates: true,
  });
}

export async function getApplicationWorkflow(applicationId: string) {
  const tasks = await prisma.applicationTask.findMany({
    where: { applicationId },
  });
  const order = new Map(APPLICATION_TASK_DEFINITIONS.map((definition) => [definition.key, definition.sortOrder]));
  tasks.sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999));
  return {
    tasks,
    readiness: deriveApplicationReadiness(tasks),
  };
}

export async function startApplicationTask(
  applicationId: string,
  key: ApplicationTaskKeyValue,
  staleAfterMs = 10 * 60 * 1000
) {
  await initializeApplicationWorkflow(applicationId);
  const staleBefore = new Date(Date.now() - staleAfterMs);
  const result = await prisma.applicationTask.updateMany({
    where: {
      applicationId,
      key: taskKey(key),
      OR: [
        { status: { not: ApplicationTaskStatus.RUNNING } },
        { status: ApplicationTaskStatus.RUNNING, startedAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: ApplicationTaskStatus.RUNNING,
      // Optional sub-flows become part of readiness once the user starts them.
      required: true,
      attempt: { increment: 1 },
      errorCode: null,
      errorMessage: null,
      startedAt: new Date(),
      completedAt: null,
    },
  });
  const task = await prisma.applicationTask.findUniqueOrThrow({
    where: { applicationId_key: { applicationId, key: taskKey(key) } },
  });
  if (result.count > 0) {
    await recordApplicationEvent(applicationId, "WORKFLOW_TASK_STARTED", `${key} started`, {
      taskKey: key,
      attempt: task.attempt,
    });
  }
  return { task, alreadyRunning: result.count === 0 };
}

export async function completeApplicationTask(
  applicationId: string,
  key: ApplicationTaskKeyValue,
  options: TaskMetadataOptions = {}
) {
  await initializeApplicationWorkflow(applicationId);
  const task = await prisma.applicationTask.update({
    where: { applicationId_key: { applicationId, key: taskKey(key) } },
    data: {
      status: ApplicationTaskStatus.SUCCESS,
      errorCode: null,
      errorMessage: null,
      metadata: options.metadata,
      completedAt: new Date(),
    },
  });
  await recordApplicationEvent(applicationId, "WORKFLOW_TASK_COMPLETED", `${key} completed`, {
    taskKey: key,
    attempt: task.attempt,
    ...(options.metadata ? { result: options.metadata } : {}),
  });
  return task;
}

export async function failApplicationTask(
  applicationId: string,
  key: ApplicationTaskKeyValue,
  error: unknown,
  options: FailTaskOptions = {}
) {
  await initializeApplicationWorkflow(applicationId);
  const message = error instanceof Error ? error.message : String(error);
  const task = await prisma.applicationTask.update({
    where: { applicationId_key: { applicationId, key: taskKey(key) } },
    data: {
      status: ApplicationTaskStatus.FAILED,
      errorCode: options.code ?? null,
      errorMessage: message.slice(0, 1000),
      metadata: options.metadata,
      completedAt: new Date(),
    },
  });
  await recordApplicationEvent(applicationId, "WORKFLOW_TASK_FAILED", `${key} failed: ${message.slice(0, 500)}`, {
    taskKey: key,
    attempt: task.attempt,
    errorCode: options.code ?? null,
  });
  return task;
}

export async function markApplicationTaskNeedsReview(
  applicationId: string,
  key: ApplicationTaskKeyValue,
  detail: string,
  options: TaskMetadataOptions = {}
) {
  await initializeApplicationWorkflow(applicationId);
  const task = await prisma.applicationTask.update({
    where: { applicationId_key: { applicationId, key: taskKey(key) } },
    data: {
      status: ApplicationTaskStatus.NEEDS_REVIEW,
      errorCode: null,
      errorMessage: detail.slice(0, 1000),
      metadata: options.metadata,
      completedAt: new Date(),
    },
  });
  await recordApplicationEvent(applicationId, "WORKFLOW_TASK_NEEDS_REVIEW", `${key}: ${detail.slice(0, 500)}`, {
    taskKey: key,
  });
  return task;
}

export async function recordApplicationEvent(
  applicationId: string,
  type: string,
  detail?: string,
  metadata?: Prisma.InputJsonValue
) {
  return prisma.event.create({
    data: {
      applicationId,
      type,
      detail: detail ?? null,
      metadata,
    },
  });
}
