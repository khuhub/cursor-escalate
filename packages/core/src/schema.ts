import { z } from "zod";

const IsoStringSchema = z.string().min(1);

export const CriterionSchema = z
  .object({
    id: z.string().min(1),
    statement: z.string().min(1),
    type: z.enum(["reward", "penalty"]),
    weight: z.union([z.literal(10), z.literal(5), z.literal(2)]),
    check: z.enum(["deterministic", "judged"]),
    command: z.string().min(1).optional(),
    judge_hint: z.string().min(1).optional(),
    source: z.enum(["generated", "comment"]).default("generated"),
    calibration_examples: z
      .array(
        z.object({
          diffExcerpt: z.string(),
          verdict: z.enum(["pass", "fail"]),
          reason: z.string()
        })
      )
      .optional()
  })
  .superRefine((criterion, ctx) => {
    if (criterion.check === "deterministic" && !criterion.command) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["command"],
        message: "deterministic criteria require command"
      });
    }
    if (criterion.check === "judged" && !criterion.judge_hint) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["judge_hint"],
        message: "judged criteria require judge_hint"
      });
    }
  });

export const RubricSchema = z
  .object({
    goal_summary: z.string().min(1),
    pass_threshold: z.number().min(0).max(1),
    criteria: z.array(CriterionSchema).min(5).max(10),
    generated_by_model: z.string().min(1),
    frozen_at: IsoStringSchema
  })
  .superRefine((rubric, ctx) => {
    const penalties = rubric.criteria.filter(
      (criterion) => criterion.type === "penalty"
    );
    if (penalties.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["criteria"],
        message: "rubrics require at least 2 penalty criteria"
      });
    }
  });

export const CriterionResultSchema = z.object({
  criterion_id: z.string().min(1),
  passed: z.boolean(),
  kind: z.enum(["deterministic", "judged"]),
  command_output: z.string().optional(),
  judge_reasoning: z.string().optional()
});

export const IterationSchema = z.object({
  index: z.number().int().nonnegative(),
  model_id: z.string().min(1),
  tier: z.number().int().nonnegative(),
  started_at: IsoStringSchema,
  finished_at: IsoStringSchema,
  run_status: z.enum(["finished", "error", "cancelled"]),
  diff: z.string(),
  diff_vs_prev: z.string(),
  criterion_results: z.array(CriterionResultSchema),
  score: z.number().min(0).max(1),
  raw_assistant_summary: z.string(),
  cost_hint: z.object({ durationMs: z.number().optional() }).optional()
});

export const LoopEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rubric_generated"),
    at: IsoStringSchema,
    model_id: z.string().min(1)
  }),
  z.object({
    kind: z.literal("iteration"),
    at: IsoStringSchema,
    iteration_index: z.number().int().nonnegative()
  }),
  z.object({
    kind: z.literal("escalation"),
    at: IsoStringSchema,
    from_model: z.string().min(1),
    to_model: z.string().min(1),
    reason: z.enum(["plateau", "critical_failing", "run_error"])
  }),
  z.object({
    kind: z.literal("comment"),
    at: IsoStringSchema,
    comment_id: z.string().min(1)
  }),
  z.object({
    kind: z.literal("rubric_mutation"),
    at: IsoStringSchema,
    comment_id: z.string().min(1),
    criterion_id: z.string().min(1),
    action: z.enum(["added", "patched", "calibrated"])
  }),
  z.object({
    kind: z.literal("loop_finished"),
    at: IsoStringSchema,
    outcome: z.enum(["passed", "exhausted", "cancelled"])
  })
]);

export const CommentSchema = z.object({
  id: z.string().min(1),
  at: IsoStringSchema,
  node_ref: z.object({
    type: z.enum(["iteration", "rubric"]),
    index: z.number().int().nonnegative().optional()
  }),
  text: z.string().min(1),
  disputes_criterion_id: z.string().min(1).optional(),
  resulting_mutation: z
    .object({
      criterion_id: z.string().min(1),
      action: z.enum(["added", "patched", "calibrated"])
    })
    .nullable()
    .optional()
});

export const LoopArtifactSchema = z.object({
  schema_version: z.literal(1),
  loop_id: z.string().min(1),
  goal_prompt: z.string().min(1),
  repo: z.object({
    mode: z.enum(["local", "cloud"]),
    path_or_url: z.string().min(1),
    baseline_ref: z.string().min(1)
  }),
  model_ladder: z.array(z.string().min(1)).min(1),
  rubric: RubricSchema,
  iterations: z.array(IterationSchema),
  events: z.array(LoopEventSchema),
  comments: z.array(CommentSchema),
  status: z.enum([
    "generating_rubric",
    "running",
    "awaiting_iteration",
    "passed",
    "exhausted",
    "cancelled",
    "error"
  ]),
  progress: z.number().min(0).max(1),
  created_at: IsoStringSchema,
  updated_at: IsoStringSchema
});

export type Criterion = z.infer<typeof CriterionSchema>;
export type Rubric = z.infer<typeof RubricSchema>;
export type CriterionResult = z.infer<typeof CriterionResultSchema>;
export type Iteration = z.infer<typeof IterationSchema>;
export type LoopEvent = z.infer<typeof LoopEventSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type LoopArtifact = z.infer<typeof LoopArtifactSchema>;

export const criterionSchema = CriterionSchema;
export const rubricSchema = RubricSchema;
export const criterionResultSchema = CriterionResultSchema;
export const iterationSchema = IterationSchema;
export const loopEventSchema = LoopEventSchema;
export const commentSchema = CommentSchema;
export const loopArtifactSchema = LoopArtifactSchema;
