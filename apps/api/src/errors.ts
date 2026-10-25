import type { FastifyError, FastifyInstance } from "fastify";
import { z } from "zod";
import type { ApiErrorBody } from "@reprolab/shared";

/** An error with an HTTP status and a stable machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new ApiError(404, "NOT_FOUND", `${what} not found.`);

/** Validates input with a Zod schema or throws a 400 with field-level details. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ApiError(
      400,
      "VALIDATION_FAILED",
      "The request is invalid.",
      result.error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    );
  }
  return result.data;
}

export const IdParamSchema = z.object({ id: z.uuid({ error: "Invalid id." }) });

/**
 * Every error response has the same shape: { error: { code, message, details? } }.
 * With `spaFallback`, unknown non-API GETs serve the web UI's index.html instead.
 */
export function registerErrorHandling(app: FastifyInstance, spaFallback = false): void {
  app.setErrorHandler((error: FastifyError | ApiError, request, reply) => {
    if (error instanceof ApiError) {
      const body: ApiErrorBody = { error: { code: error.code, message: error.message, details: error.details } };
      return reply.code(error.statusCode).send(body);
    }
    // Fastify's own client errors (malformed JSON, body too large, wrong content type).
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.code(error.statusCode).send({ error: { code: error.code ?? "BAD_REQUEST", message: error.message } });
    }
    request.log.error({ err: error }, "Unhandled error");
    return reply.code(500).send({ error: { code: "INTERNAL_ERROR", message: "Something went wrong on the server." } });
  });

  app.setNotFoundHandler((request, reply) => {
    if (spaFallback && request.method === "GET" && !request.url.startsWith("/api/")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: { code: "NOT_FOUND", message: `No route for ${request.method} ${request.url.split("?")[0]}.` } });
  });
}
