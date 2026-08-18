import { listMCPResources, readMCPResource } from '@/lib/mcp';
import fs from 'fs';
import path from 'path';

const YANDEX_EMBEDDING_URL =
  'https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding';
const YANDEX_FOLDER_ID = process.env.YC_FOLDER_ID;
const YANDEX_API_KEY = process.env.YC_API_KEY;

const CHUNK_SIZE = 800;
const INDEX_FILE = path.join(process.cwd(), 'data', 'rag-index.json');
const CONCURRENCY = 4;
const REQUEST_DELAY_MS = 250;

interface IndexChunk {
  uri: string;
  text: string;
  embedding: number[];
}

interface SearchResult {
  uri: string;
  text: string;
  score: number;
}

let cachedIndex: IndexChunk[] | null = null;

async function embedText(text: string, type: 'query' | 'doc'): Promise<number[]> {
  const model =
    type === 'query' ? 'text-search-query' : 'text-search-doc';
  const url = YANDEX_EMBEDDING_URL;
  const headers = {
    Authorization: `Api-Key ${YANDEX_API_KEY}`,
    'x-folder-id': YANDEX_FOLDER_ID!,
    'Content-Type': 'application/json',
  };
  const body = JSON.stringify({
    modelUri: `emb://${YANDEX_FOLDER_ID}/${model}/latest`,
    text,
  });

  let attempts = 0;
  while (attempts < 5) {
    attempts++;
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
    });

    if (response.ok) {
      const data = await response.json();
      return data.embedding as number[];
    }

    if (response.status === 429) {
      const wait = REQUEST_DELAY_MS * attempts * 4;
      console.warn(
        `⏳ Квота эмбеддингов (попытка ${attempts}/5), ждём ${wait}мс...`,
      );
      await sleep(wait);
      continue;
    }

    const errorText = await response.text();
    throw new Error(`Embedding API error: ${response.status} - ${errorText}`);
  }

  throw new Error('Embedding API: квота превышена, попытки исчерпаны');
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function embedMany(texts: string[], type: 'query' | 'doc'): Promise<number[][]> {
  const results: number[][] = [];
  let i = 0;

  async function worker() {
    while (i < texts.length) {
      const idx = i++;
      results[idx] = await embedText(texts[idx], type);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, texts.length) }, worker),
  );
  return results;
}

function chunkText(text: string, maxLen: number = CHUNK_SIZE): string[] {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (current && (current + '\n\n' + para).length > maxLen) {
      chunks.push(current);
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

export async function buildRagIndex(): Promise<{
  count: number;
  uris: string[];
}> {
  console.log('🏗️  Строим RAG-индекс из MCP-ресурсов...');

  const resources = await listMCPResources();

  const chunks: IndexChunk[] = [];
  for (const res of resources) {
    try {
      const text = await readMCPResource(res.uri);
      const parts = chunkText(text);
      for (const part of parts) {
        chunks.push({ uri: res.uri, text: part, embedding: [] });
      }
    } catch (e) {
      console.warn(`⚠️ Не удалось прочитать ресурс ${res.uri}:`, e);
    }
  }

  const texts = chunks.map((c) => c.text);
  const embeddings = await embedMany(texts, 'doc');
  chunks.forEach((c, i) => (c.embedding = embeddings[i]));

  fs.mkdirSync(path.dirname(INDEX_FILE), { recursive: true });
  fs.writeFileSync(
    INDEX_FILE,
    JSON.stringify({
      builtAt: new Date().toISOString(),
      chunks,
    }),
  );

  cachedIndex = chunks;
  console.log(
    `✅ RAG-индекс готов: ${chunks.length} чанков из ${resources.length} ресурсов`,
  );

  return { count: chunks.length, uris: resources.map((r) => r.uri) };
}

export async function getRagIndex(forceRebuild = false): Promise<IndexChunk[]> {
  if (cachedIndex && !forceRebuild) return cachedIndex;

  if (!forceRebuild && fs.existsSync(INDEX_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      cachedIndex = parsed.chunks as IndexChunk[];
      return cachedIndex;
    } catch (e) {
      console.warn('⚠️ Битый файл индекса, пересобираем:', e);
    }
  }

  await buildRagIndex();
  const parsed = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  cachedIndex = parsed.chunks as IndexChunk[];
  return cachedIndex;
}

export async function searchRag(
  query: string,
  topK = 3,
  minScore = 0.33,
): Promise<SearchResult[]> {
  const index = await getRagIndex();
  if (index.length === 0) return [];

  const queryEmbedding = await embedText(query, 'query');

  return index
    .map((c) => ({
      uri: c.uri,
      text: c.text,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }))
    .filter((r) => r.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

export async function buildRagContext(query: string): Promise<string> {
  const results = await searchRag(query);
  if (results.length === 0) return '';

  return results
    .map((r) => `[источник: ${r.uri}]\n${r.text}`)
    .join('\n\n---\n\n');
}