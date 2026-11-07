import type { Db } from '../db.js';

/** Thrown when today's AI call budget is used up. The message is failed with error code `ai_budget`. */
export class AiBudgetError extends Error {
  constructor(readonly limit: number) {
    super(`the AI budget of ${limit} calls for today is used up`);
    this.name = 'AiBudgetError';
  }
}

export interface BudgetStatus {
  callsToday: number;
  limit: number;
}

/** Something that must allow each model call first (the daily budget, or nothing in tests). */
export interface Reserve {
  reserve(): void;
}

/**
 * A daily cap on model calls (AI_DAILY_CALL_LIMIT), counted per UTC day in the ai_usage table, so
 * the public demo cannot run up the Gemini bill. Every model attempt, fallback attempts and TTS
 * included, reserves one call first.
 */
export class AiBudget implements Reserve {
  constructor(
    private readonly db: Db,
    readonly limit: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private day(): string {
    return this.now().toISOString().slice(0, 10);
  }

  /** Counts one call for today, or throws AiBudgetError when the limit is reached (nothing is counted then). */
  reserve(): void {
    const row = this.db
      .prepare('INSERT INTO ai_usage (day, calls) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET calls = calls + 1 WHERE calls < ? RETURNING calls')
      .get(this.day(), this.limit);
    if (!row) throw new AiBudgetError(this.limit);
  }

  status(): BudgetStatus {
    const row = this.db.prepare('SELECT calls FROM ai_usage WHERE day = ?').get(this.day()) as { calls: number } | undefined;
    return { callsToday: row?.calls ?? 0, limit: this.limit };
  }
}
