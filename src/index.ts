import { createAgent } from '@lucid-agents/core';
import { http } from '@lucid-agents/http';
import { createAgentApp } from '@lucid-agents/hono';
import { payments, paymentsFromEnv } from '@lucid-agents/payments';
import { z } from 'zod';

const SEMANTIC_SCHOLAR_BASE = 'https://api.semanticscholar.org/graph/v1';

const agent = await createAgent({
  name: 'research-intel',
  version: '1.0.0',
  description: 'Academic research intelligence - paper search, author lookup, citations via Semantic Scholar',
})
  .use(http())
  .use(payments({ config: paymentsFromEnv() }))
  .build();

const { app, addEntrypoint } = await createAgentApp(agent);

// === HELPER: Fetch from Semantic Scholar API ===
async function fetchS2(path: string) {
  const response = await fetch(`${SEMANTIC_SCHOLAR_BASE}${path}`);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Semantic Scholar API error: ${response.status} - ${text}`);
  }
  return response.json();
}

// === FREE ENDPOINT: Overview ===
addEntrypoint({
  key: 'overview',
  description: 'Free overview - agent capabilities and pricing',
  input: z.object({}),
  price: { amount: 0 },
  handler: async () => {
    return {
      output: {
        agent: 'research-intel',
        version: '1.0.0',
        description: 'Academic research intelligence powered by Semantic Scholar',
        dataSource: 'Semantic Scholar API (200M+ papers)',
        endpoints: {
          'paper-search': { price: '$0.001', description: 'Search papers by keyword' },
          'paper-details': { price: '$0.002', description: 'Get full paper metadata, abstract, authors' },
          'author-search': { price: '$0.001', description: 'Find researchers by name' },
          'author-papers': { price: '$0.002', description: 'Get all papers by an author' },
          'citations': { price: '$0.003', description: 'Get papers citing a given paper' }
        },
        exampleQueries: [
          { endpoint: 'paper-search', input: { query: 'large language models', limit: 10 } },
          { endpoint: 'author-search', input: { query: 'Geoffrey Hinton' } }
        ],
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 1: Paper Search ($0.001) ===
addEntrypoint({
  key: 'paper-search',
  description: 'Search academic papers by keyword query',
  input: z.object({
    query: z.string().describe('Search query (e.g., "machine learning", "climate change")'),
    limit: z.number().min(1).max(100).optional().default(10).describe('Number of results (1-100)'),
    year: z.string().optional().describe('Filter by year range (e.g., "2020-2024" or "2023")')
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const { query, limit, year } = ctx.input;
    const yearParam = year ? `&year=${year}` : '';
    const data = await fetchS2(
      `/paper/search?query=${encodeURIComponent(query)}&limit=${limit}${yearParam}&fields=paperId,title,year,citationCount,authors,venue`
    );
    return {
      output: {
        query,
        total: data.total || 0,
        papers: data.data || [],
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 2: Paper Details ($0.002) ===
addEntrypoint({
  key: 'paper-details',
  description: 'Get full paper details including abstract and references',
  input: z.object({
    paperId: z.string().describe('Semantic Scholar paper ID, DOI, or arXiv ID')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const { paperId } = ctx.input;
    const data = await fetchS2(
      `/paper/${encodeURIComponent(paperId)}?fields=paperId,title,abstract,year,citationCount,referenceCount,influentialCitationCount,fieldsOfStudy,authors,venue,publicationDate,openAccessPdf,externalIds`
    );
    return {
      output: {
        paper: data,
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 3: Author Search ($0.001) ===
addEntrypoint({
  key: 'author-search',
  description: 'Search for academic authors/researchers by name',
  input: z.object({
    query: z.string().describe('Author name to search'),
    limit: z.number().min(1).max(50).optional().default(10).describe('Number of results (1-50)')
  }),
  price: { amount: 1000 },
  handler: async (ctx) => {
    const { query, limit } = ctx.input;
    const data = await fetchS2(
      `/author/search?query=${encodeURIComponent(query)}&limit=${limit}&fields=authorId,name,affiliations,paperCount,citationCount,hIndex`
    );
    return {
      output: {
        query,
        authors: data.data || [],
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 4: Author Papers ($0.002) ===
addEntrypoint({
  key: 'author-papers',
  description: 'Get all papers published by an author',
  input: z.object({
    authorId: z.string().describe('Semantic Scholar author ID'),
    limit: z.number().min(1).max(100).optional().default(20).describe('Number of papers (1-100)')
  }),
  price: { amount: 2000 },
  handler: async (ctx) => {
    const { authorId, limit } = ctx.input;
    // First get author details
    const author = await fetchS2(`/author/${authorId}?fields=authorId,name,paperCount,citationCount,hIndex`);
    // Then get their papers
    const papers = await fetchS2(
      `/author/${authorId}/papers?fields=paperId,title,year,citationCount,venue&limit=${limit}`
    );
    return {
      output: {
        author,
        papers: papers.data || [],
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

// === PAID ENDPOINT 5: Paper Citations ($0.003) ===
addEntrypoint({
  key: 'citations',
  description: 'Get papers that cite a given paper',
  input: z.object({
    paperId: z.string().describe('Semantic Scholar paper ID, DOI, or arXiv ID'),
    limit: z.number().min(1).max(100).optional().default(20).describe('Number of citations (1-100)')
  }),
  price: { amount: 3000 },
  handler: async (ctx) => {
    const { paperId, limit } = ctx.input;
    // Get paper info first
    const paper = await fetchS2(`/paper/${encodeURIComponent(paperId)}?fields=title,citationCount`);
    // Get citations
    const citations = await fetchS2(
      `/paper/${encodeURIComponent(paperId)}/citations?fields=paperId,title,year,citationCount,authors,venue&limit=${limit}`
    );
    return {
      output: {
        paper: {
          paperId: paperId,
          title: paper.title,
          totalCitations: paper.citationCount
        },
        citations: citations.data?.map((c: any) => c.citingPaper) || [],
        fetchedAt: new Date().toISOString()
      }
    };
  },
});

const port = Number(process.env.PORT ?? 3000);
console.log(`Research Intel Agent running on port ${port}`);

export default { port, fetch: app.fetch };
