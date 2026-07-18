import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { Pool } from "pg";
import { NextRequest } from "next/server";
import { makePgSql, freshSchema } from "@/lib/server/__tests__/helpers/pg-sql";
import type { Sql } from "@/lib/server/db";

const TEST_SCHEMA = "wd_test_articles_route";
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const pool = TEST_DATABASE_URL
  ? new Pool({ connectionString: TEST_DATABASE_URL, options: `-c search_path=${TEST_SCHEMA}` })
  : null;

let currentSql: Sql;

vi.mock("@/lib/server/db", () => ({
  getSql: () => currentSql,
}));

const { GET } = await import("../route");

interface ArticleRow {
  id: string;
}

async function insertArticle(sql: Sql, overrides: {
  contentHash: string;
  titleSignature: string;
  title: string;
  link: string;
  publishedAgo: string;
  firstSeenAgo: string;
  sourceName?: string;
  dupGroupId?: string | null;
}): Promise<ArticleRow> {
  const rows = await sql`
    INSERT INTO articles (content_hash, title_signature, title, link, published_at, first_seen_at, source_name, source_category, source_tier, dup_group_id)
    VALUES (
      ${overrides.contentHash}, ${overrides.titleSignature}, ${overrides.title}, ${overrides.link},
      now() - ${overrides.publishedAgo}::interval, now() - ${overrides.firstSeenAgo}::interval,
      ${overrides.sourceName ?? "Source A"}, 'world', '1', ${overrides.dupGroupId ?? null}
    )
    RETURNING id
  `;
  return rows[0] as unknown as ArticleRow;
}

describe.skipIf(!TEST_DATABASE_URL)("GET /api/articles integration (real Postgres)", () => {
  beforeEach(async () => {
    await freshSchema(pool!, TEST_SCHEMA);
    currentSql = makePgSql(pool!);
    process.env.DATABASE_URL = "postgres://fake";
  });

  afterAll(async () => {
    delete process.env.DATABASE_URL;
    await pool?.end();
  });

  it("a dup-group member's later arrival becomes the head's updatedAt, not the head's own first_seen_at", async () => {
    const head = await insertArticle(currentSql, {
      contentHash: "hash-head",
      titleSignature: "sig-1",
      title: "Head story",
      link: "https://a.example.com/1",
      publishedAgo: "2 hours",
      firstSeenAgo: "2 hours",
      sourceName: "Source A",
    });
    await insertArticle(currentSql, {
      contentHash: "hash-member",
      titleSignature: "sig-1",
      title: "Head story, follow-up",
      link: "https://b.example.com/2",
      publishedAgo: "1 hour",
      firstSeenAgo: "10 minutes",
      sourceName: "Source B",
      dupGroupId: head.id,
    });

    const res = await GET(new NextRequest("http://localhost/api/articles"));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.items).toHaveLength(1); // only the head is served
    expect(body.items[0].id).toBe(String(head.id));

    const updatedAgeMs = Date.now() - new Date(body.items[0].updatedAt).getTime();
    const publishedAgeMs = Date.now() - new Date(body.items[0].published).getTime();
    // updatedAt tracks the member's ~10min-old arrival, not the head's own ~2h-old first_seen_at.
    expect(updatedAgeMs).toBeLessThan(60 * 60 * 1000);
    expect(publishedAgeMs).toBeGreaterThan(60 * 60 * 1000);
  });

  it("a head with no members has updatedAt equal to its own first_seen_at", async () => {
    await insertArticle(currentSql, {
      contentHash: "hash-solo",
      titleSignature: "sig-2",
      title: "Solo story",
      link: "https://c.example.com/3",
      publishedAgo: "3 hours",
      firstSeenAgo: "3 hours",
    });

    const res = await GET(new NextRequest("http://localhost/api/articles"));
    const body = await res.json();

    expect(body.items).toHaveLength(1);
    const updatedAt = new Date(body.items[0].updatedAt).getTime();
    const firstSeenAt = new Date(body.items[0].published).getTime();
    expect(Math.abs(updatedAt - firstSeenAt)).toBeLessThan(5000);
  });

  it("sorts by the cluster's updatedAt, not by publish time", async () => {
    // Story A: published recently, nothing has updated it since.
    const storyA = await insertArticle(currentSql, {
      contentHash: "hash-a",
      titleSignature: "sig-a",
      title: "Story A",
      link: "https://a.example.com/a",
      publishedAgo: "10 minutes",
      firstSeenAgo: "10 minutes",
    });
    // Story B: published long ago, but a member just arrived — its cluster
    // updatedAt is now newer than Story A's, so B must rank above A.
    const storyB = await insertArticle(currentSql, {
      contentHash: "hash-b",
      titleSignature: "sig-b",
      title: "Story B",
      link: "https://b.example.com/b",
      publishedAgo: "3 days",
      firstSeenAgo: "3 days",
    });
    await insertArticle(currentSql, {
      contentHash: "hash-b2",
      titleSignature: "sig-b",
      title: "Story B, follow-up",
      link: "https://b.example.com/b2",
      publishedAgo: "2 minutes",
      firstSeenAgo: "2 minutes",
      sourceName: "Source C",
      dupGroupId: storyB.id,
    });

    const res = await GET(new NextRequest("http://localhost/api/articles"));
    const body = await res.json();
    const ids: string[] = body.items.map((item: { id: string }) => item.id);

    expect(ids.indexOf(String(storyB.id))).toBeLessThan(ids.indexOf(String(storyA.id)));
  });
});
