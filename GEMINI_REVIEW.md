# GEMINI_REVIEW.md — Codebase Review (2026-05-19)

## Executive Summary
DevBrain is a robust, locally-hosted developer knowledge base with a clear vision and a sophisticated RAG-based AI integration. The project demonstrates strong proficiency in modern full-stack development (React, Node, PostgreSQL, Ollama) and a commendable commitment to privacy and zero-cost AI.

However, the codebase suffers from a total lack of automated testing and some architectural technical debt stemming from rapid feature development. While Phase 14 and 15 in `TASKS.md` correctly identify many of these issues, they remain largely unimplemented.

## Scorecard

| Category     | Score | Rating       |
|--------------|-------|--------------|
| Code Quality | 6/10  | Good         |
| Architecture | 6/10  | Good         |
| Testing      | 0/10  | Non-existent |
| Security     | 7/10  | Strong       |
| Design & UI  | 7/10  | Strong       |
| **Total**    | **5.2/10**| **Average**  |

---

## Detailed Review

### 1. Code Quality (6/10)
- **Strengths**: Strict TypeScript usage, clean service-oriented backend, use of modern libraries (Zustand, React Query, Shiki).
- **Weaknesses**: Some remaining monolithic components (even after splitting `Issues.tsx`, other pages like `Dashboard.tsx` or `Documents.tsx` might need review). Lack of consistent formatting/linting enforcement in CI (none found).
- **Notes**: The code is readable and well-organized by domain.

### 2. Architecture (6/10)
- **Strengths**: Excellent service abstraction for AI (`ai.ts`), allowing easy swapping between local and cloud models. Good use of `pgvector` for semantic search.
- **Weaknesses**: 
    - **JSONB Race Conditions**: Storing investigation steps and notes as JSONB arrays in a single column is prone to data loss during concurrent edits.
    - **Routing Debt**: The custom event-based navigation system is fragile and non-idiomatic (though currently being replaced by React Router).
    - **State Management**: Some state might be better served by URL parameters (e.g., selected project, filters) to enable deep linking.

### 3. Testing (0/10)
- **Strengths**: None.
- **Weaknesses**: There are **no automated tests** in the codebase. No unit tests for critical AI/RAG logic, no integration tests for the API, and no E2E tests for the frontend.
- **Action**: This is the highest priority for technical debt reduction.

### 4. Security (7/10)
- **Strengths**: JWT-based auth, password hashing with bcrypt, rate limiting on login, audit logging, and SSRF protection for URL imports.
- **Weaknesses**: JWT still being moved from `localStorage` to `HttpOnly` cookies (Phase 13 task). Docker compose secrets were recently moved to env files, which is good.

### 5. Design & UI (7/10)
- **Strengths**: Polished dark-mode aesthetic, consistent use of project-specific colors, and responsive-ready Tailwind CSS.
- **Weaknesses**: 
    - **Accessibility (A11y)**: Missing aria-labels, focus rings, and proper ARIA roles for modals.
    - **Responsiveness**: Needs better handling for tablet and mobile viewports.
    - **UX**: Abrupt transitions; could benefit from entry/exit animations.

---

## Action Items (Prioritized)

1. **Phase 16 — Testing Foundation**: 
    - Setup Vitest for unit testing.
    - Setup Playwright for E2E testing.
    - Write unit tests for `server/services/ai.ts` and `server/services/parser.ts`.
2. **Complete Phase 14 (Architecture)**:
    - Normalize `investigation_steps` and `notes` into separate tables.
    - Complete the React Router migration for project-scoped URLs.
3. **Complete Phase 13 (Security)**:
    - Finalize the move to `HttpOnly` cookies for JWT.
4. **Complete Phase 15 (UI/UX)**:
    - Implement basic A11y improvements (focus rings, aria-labels).
    - Add responsive drawer for mobile/tablet.
5. **API Documentation**:
    - Add Swagger/OpenAPI to provide a browsable API reference.
