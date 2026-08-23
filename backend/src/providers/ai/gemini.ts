import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { createHash } from "node:crypto";
import { config, flags } from "../../config.js";
import { logger } from "../../lib/logger.js";

export interface PersonalityProfile {
  summary: string;
  coreValues: string[];
  communicationStyle: string;
  attachmentTendency: string;
  relationshipGoals: string;
  dealbreakers: string[];
}

export interface ProfileGenerationResult {
  profile: PersonalityProfile;
  embedding: number[];
  modelVersion: string;
  source: "gemini" | "stub";
}

// gemini-embedding-001 (text-embedding-004's replacement) natively outputs
// 3072 dims, but pgvector's ivfflat index caps at 2000. The model is
// Matryoshka-trained so truncating to a prefix preserves quality — see
// embedProfile() below, which truncates+renormalizes to this size, and
// migrations/011.
const EMBEDDING_DIM = 768;
const EMBEDDING_MODEL = "gemini-embedding-001";
const PROFILE_MODEL_VERSION = `${config.GEMINI_MODEL}@v1-questionnaire-prompt`;
const STUB_MODEL_VERSION = "stub@v1";

const genAI = flags.aiEnabled ? new GoogleGenerativeAI(config.GEMINI_API_KEY) : null;

const profileResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    summary: { type: SchemaType.STRING },
    coreValues: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
    communicationStyle: { type: SchemaType.STRING },
    attachmentTendency: { type: SchemaType.STRING },
    relationshipGoals: { type: SchemaType.STRING },
    dealbreakers: { type: SchemaType.ARRAY, items: { type: SchemaType.STRING } },
  },
  required: [
    "summary",
    "coreValues",
    "communicationStyle",
    "attachmentTendency",
    "relationshipGoals",
    "dealbreakers",
  ],
};

const SYSTEM_PROMPT = `You are a data-extraction step in a dating app's matching pipeline, not a
conversational assistant. Given a user's questionnaire answers, extract a structured personality
profile as JSON matching the provided schema. Be concrete and specific — avoid generic filler
like "loves adventure." Base every field strictly on what the answers actually say; do not invent
details the user didn't provide. This output is used for compatibility matching, not shown
verbatim to the user.`;

/**
 * Turns raw questionnaire answers into a structured personality profile plus
 * an embedding vector for similarity search. Runs in deterministic stub mode
 * when GEMINI_API_KEY is unset (see docs/backend-architecture-prompt.md and
 * the "Gemini key" decision this session made — the pipeline must be fully
 * testable before a real key is added), so the rest of Phase 3/4 is buildable
 * and testable immediately.
 */
export async function generatePersonalityProfile(
  answers: Record<string, unknown>,
): Promise<ProfileGenerationResult> {
  if (!genAI) {
    return stubProfile(answers);
  }

  try {
    const model = genAI.getGenerativeModel({
      model: config.GEMINI_MODEL,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: profileResponseSchema,
      },
    });

    const result = await model.generateContent(
      `Questionnaire answers (JSON):\n${JSON.stringify(answers, null, 2)}`,
    );
    const profile = JSON.parse(result.response.text()) as PersonalityProfile;
    const embedding = await embedProfile(profile);

    return { profile, embedding, modelVersion: PROFILE_MODEL_VERSION, source: "gemini" };
  } catch (err) {
    logger.error({ err }, "Gemini profile generation failed, falling back to stub");
    return stubProfile(answers);
  }
}

async function embedProfile(profile: PersonalityProfile): Promise<number[]> {
  if (!genAI) {
    return deterministicEmbedding(JSON.stringify(profile));
  }

  const embeddingModel = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
  const text = [
    profile.summary,
    profile.coreValues.join(", "),
    profile.communicationStyle,
    profile.attachmentTendency,
    profile.relationshipGoals,
    profile.dealbreakers.join(", "),
  ].join("\n");

  const result = await embeddingModel.embedContent(text);
  return truncateAndRenormalize(result.embedding.values, EMBEDDING_DIM);
}

/**
 * gemini-embedding-001 is Matryoshka-trained: its dimensions are ordered by
 * importance, so keeping the first N and re-normalizing to unit length is a
 * supported way to shrink it (this is what the API's own
 * `outputDimensionality` param does server-side; the installed SDK version
 * doesn't expose that param, so it's replicated here).
 */
function truncateAndRenormalize(values: number[], dim: number): number[] {
  const truncated = values.slice(0, dim);
  const norm = Math.sqrt(truncated.reduce((sum, v) => sum + v * v, 0));
  return norm === 0 ? truncated : truncated.map((v) => v / norm);
}

function stubProfile(answers: Record<string, unknown>): ProfileGenerationResult {
  const seed = JSON.stringify(answers);
  const profile: PersonalityProfile = {
    summary: "Stub profile generated without a live Gemini API key.",
    coreValues: ["honesty", "growth"],
    communicationStyle: "direct",
    attachmentTendency: "secure",
    relationshipGoals: "long-term",
    dealbreakers: [],
  };
  return {
    profile,
    embedding: deterministicEmbedding(seed),
    modelVersion: STUB_MODEL_VERSION,
    source: "stub",
  };
}

/**
 * A seeded pseudo-random unit vector, deterministic per input string, so
 * different stub users still get distinguishable (if meaningless) embeddings
 * for testing the matching engine's similarity search before a real API key
 * is wired in.
 */
function deterministicEmbedding(seed: string): number[] {
  const vector: number[] = [];
  let state = createHash("sha256").update(seed).digest();

  while (vector.length < EMBEDDING_DIM) {
    state = createHash("sha256").update(state).digest();
    for (let i = 0; i < state.length && vector.length < EMBEDDING_DIM; i += 4) {
      const int = state.readUInt32BE(i);
      vector.push(int / 0xffffffff - 0.5);
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  return vector.map((v) => v / norm);
}
