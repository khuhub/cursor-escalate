import type { ModelSelection } from "@cursor/sdk";
import {
  parseJsonFromText,
  runCursorPrompt,
  type CursorRuntime,
  type CursorStreamEvent
} from "./cursor.js";
import {
  criterionSchema,
  rubricSchema,
  type Comment,
  type Criterion,
  type CriterionResult,
  type LoopEvent,
  type Rubric
} from "./schema.js";
import { z } from "zod";

const calibrationExampleSchema = z.object({
  diffExcerpt: z.string(),
  verdict: z.enum(["pass", "fail"]),
  reason: z.string()
});

const commentMutationSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("add"),
    criterion: criterionSchema
  }),
  z.object({
    action: z.literal("patch"),
    criterion_id: z.string().min(1),
    criterion: criterionSchema
  }),
  z.object({
    action: z.literal("calibrate"),
    criterion_id: z.string().min(1),
    example: calibrationExampleSchema
  })
]);

export type ProcessCommentOptions = {
  apiKey?: string;
  rubric: Rubric;
  comment: Comment;
  runtime: CursorRuntime;
  strongestModel: ModelSelection;
  disputedResult?: CriterionResult;
  now?: () => Date;
  onEvent?: (event: CursorStreamEvent) => void;
};

export type ProcessCommentResult = {
  rubric: Rubric;
  comment: Comment;
  event: LoopEvent;
};

export async function processCommentMutation(
  options: ProcessCommentOptions
): Promise<ProcessCommentResult> {
  const response = await runCursorPrompt({
    apiKey: options.apiKey,
    model: options.strongestModel,
    runtime: options.runtime,
    prompt: buildCommentMutationPrompt(options),
    name: "cursor-looper comment mutation",
    onEvent: options.onEvent
  });
  const mutation = commentMutationSchema.parse(parseJsonFromText(response.resultText));
  return applyCommentMutation(options.rubric, options.comment, mutation, options.now);
}

export async function processPendingComments(options: {
  apiKey?: string;
  rubric: Rubric;
  comments: readonly Comment[];
  runtime: CursorRuntime;
  strongestModel: ModelSelection;
  resultsByCriterion?: ReadonlyMap<string, CriterionResult>;
  now?: () => Date;
  onEvent?: (event: CursorStreamEvent) => void;
}): Promise<{ rubric: Rubric; comments: Comment[]; events: LoopEvent[] }> {
  let rubric = options.rubric;
  const comments: Comment[] = [];
  const events: LoopEvent[] = [];

  for (const comment of options.comments) {
    if (comment.resulting_mutation) {
      comments.push(comment);
      continue;
    }
    const result = await processCommentMutation({
      apiKey: options.apiKey,
      rubric,
      comment,
      runtime: options.runtime,
      strongestModel: options.strongestModel,
      disputedResult: comment.disputes_criterion_id
        ? options.resultsByCriterion?.get(comment.disputes_criterion_id)
        : undefined,
      now: options.now,
      onEvent: options.onEvent
    });
    rubric = result.rubric;
    comments.push(result.comment);
    events.push(result.event);
  }

  return { rubric, comments, events };
}

export function buildCommentMutationPrompt(options: {
  rubric: Rubric;
  comment: Comment;
  disputedResult?: CriterionResult;
}): string {
  return [
    "Convert this user comment into exactly one rubric mutation.",
    "Reply ONLY with one JSON object in one of these shapes:",
    '{"action":"add","criterion":Criterion}',
    '{"action":"patch","criterion_id":"...","criterion":Criterion}',
    '{"action":"calibrate","criterion_id":"...","example":{"diffExcerpt":"...","verdict":"pass","reason":"..."}}',
    "Added criteria must use source \"comment\". Patch criteria must be complete Criterion objects.",
    "",
    "<comment>",
    JSON.stringify(options.comment, null, 2),
    "</comment>",
    "",
    "<current_rubric>",
    JSON.stringify(options.rubric, null, 2),
    "</current_rubric>",
    options.disputedResult
      ? [
          "",
          "<disputed_verdict>",
          JSON.stringify(options.disputedResult, null, 2),
          "</disputed_verdict>"
        ].join("\n")
      : ""
  ].join("\n");
}

type CommentMutation = z.infer<typeof commentMutationSchema>;

function applyCommentMutation(
  rubric: Rubric,
  comment: Comment,
  mutation: CommentMutation,
  now: (() => Date) | undefined
): ProcessCommentResult {
  const at = (now ?? (() => new Date()))().toISOString();

  if (mutation.action === "add") {
    const criterion = forceCommentSource(mutation.criterion);
    const nextRubric = rubricSchema.parse({
      ...rubric,
      criteria: [...rubric.criteria, criterion]
    });
    return {
      rubric: nextRubric,
      comment: {
        ...comment,
        resulting_mutation: { criterion_id: criterion.id, action: "added" }
      },
      event: {
        kind: "rubric_mutation",
        at,
        comment_id: comment.id,
        criterion_id: criterion.id,
        action: "added"
      }
    };
  }

  if (mutation.action === "patch") {
    const index = rubric.criteria.findIndex(
      (criterion) => criterion.id === mutation.criterion_id
    );
    if (index === -1) {
      throw new Error(`Cannot patch missing criterion: ${mutation.criterion_id}`);
    }
    const criteria = [...rubric.criteria];
    const patched = {
      ...mutation.criterion,
      id: mutation.criterion_id,
      source: mutation.criterion.source
    };
    criteria[index] = patched;
    const nextRubric = rubricSchema.parse({ ...rubric, criteria });
    return {
      rubric: nextRubric,
      comment: {
        ...comment,
        resulting_mutation: {
          criterion_id: mutation.criterion_id,
          action: "patched"
        }
      },
      event: {
        kind: "rubric_mutation",
        at,
        comment_id: comment.id,
        criterion_id: mutation.criterion_id,
        action: "patched"
      }
    };
  }

  const index = rubric.criteria.findIndex(
    (criterion) => criterion.id === mutation.criterion_id
  );
  if (index === -1) {
    throw new Error(`Cannot calibrate missing criterion: ${mutation.criterion_id}`);
  }
  const criterion = rubric.criteria[index];
  if (!criterion) {
    throw new Error(`Cannot calibrate missing criterion: ${mutation.criterion_id}`);
  }
  const criteria = [...rubric.criteria];
  criteria[index] = {
    ...criterion,
    calibration_examples: [
      ...(criterion.calibration_examples ?? []),
      mutation.example
    ]
  };
  const nextRubric = rubricSchema.parse({ ...rubric, criteria });
  return {
    rubric: nextRubric,
    comment: {
      ...comment,
      resulting_mutation: {
        criterion_id: mutation.criterion_id,
        action: "calibrated"
      }
    },
    event: {
      kind: "rubric_mutation",
      at,
      comment_id: comment.id,
      criterion_id: mutation.criterion_id,
      action: "calibrated"
    }
  };
}

function forceCommentSource(criterion: Criterion): Criterion {
  return { ...criterion, source: "comment" };
}
