import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";
import { Move } from "./types";
import { nlu, nluMapping } from "./nlug";

const COLLECTION = "sisu_nlu";

const client = new QdrantClient({ host: "localhost", port: 6333 });

const openai = new OpenAI({
  baseURL: "http://localhost:11434/v1/",
  apiKey: "ollama",
  dangerouslyAllowBrowser: true,
});

async function embed(input: string): Promise<number[]> {
  const result = await openai.embeddings.create({
    model: "qwen3-embedding",
    input,
    dimensions: 384,
  });
  return result.data[0].embedding;
}

/** [lab2] [VG-B] Store each known utterance and its move in Qdrant. */
export async function seedNlu(): Promise<void> {
  const exists = await client.collectionExists(COLLECTION);
  if (exists) await client.deleteCollection(COLLECTION);
  await client.createCollection(COLLECTION, {
    vectors: { size: 384, distance: "Cosine" },
  });

  const points = [];
  for (const [utterance, moves] of Object.entries(nluMapping)) {
    points.push({
      id: crypto.randomUUID(),
      vector: await embed(utterance),
      payload: {
        utterance,
        move: moves[0],
      },
    });
  }
  await client.upsert(COLLECTION, { wait: true, points });
}

/** [lab2] [VG-B] Return the move of the nearest stored utterance. */
export async function retrieveMove(utterance: string): Promise<Move[]> {
  const results = await client.query(COLLECTION, {
    query: await embed(utterance.toLowerCase()),
    limit: 1,
    with_payload: true,
  });
  const hit = results.points?.[0];
  const score = hit?.score ?? 0;
  console.log("retrieval score", score, hit?.payload);
  if (!hit || score < 0.7) return [];
  const move = hit.payload?.move as Move | undefined;
  return move ? [move] : [];
}

let seeding: Promise<void> | null = null;

/** [lab2] [VG-B] Load the example utterances once per page. */
export function ensureNluSeeded(): Promise<void> {
  if (!seeding) {
    seeding = seedNlu().catch((error) => {
      seeding = null;
      throw error;
    });
  }
  return seeding;
}

/** [lab2] [VG-B] Exact table first, then vector retrieval. */
export async function nluWithRetrieval(utterance: string): Promise<Move[]> {
  const exact = nlu(utterance);
  if (exact.length > 0) return exact;
  try {
    await ensureNluSeeded();
    return await retrieveMove(utterance);
  } catch (error) {
    console.warn("[VG-B] retrieval failed, using the exact table", error);
    return [];
  }
}