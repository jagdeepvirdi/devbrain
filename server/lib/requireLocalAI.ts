import { env } from './env.js'

export class LocalAIRequiredError extends Error {
  constructor(provider: string) {
    super(
      `This feature processes personal data and only runs with AI_PROVIDER=ollama (current: ${provider}). ` +
      'Switch to the local provider to use it.',
    )
    this.name = 'LocalAIRequiredError'
  }
}

/**
 * Safety guard for Phase 46 personal-data features (git digests, window titles,
 * browsing history). services/ai.ts can route to Claude/Gemini; these features
 * must never send their data to a cloud provider.
 */
export function requireLocalAI(): void {
  if (env.AI_PROVIDER !== 'ollama') throw new LocalAIRequiredError(env.AI_PROVIDER)
}
