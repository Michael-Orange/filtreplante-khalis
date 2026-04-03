import type { Context } from "hono";

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function errorHandler(err: Error, c: Context) {
  if (err instanceof AppError) {
    return c.json(
      { error: err.message, code: err.code },
      err.statusCode as any
    );
  }

  console.error("Unexpected error:", err.stack || err.message);
  return c.json({ error: "Erreur interne du serveur" }, 500);
}
