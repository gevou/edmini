/**
 * Check hosted ML models against their upstream source (edmini-5on follow-up).
 *
 *   pnpm models:check
 *
 * Reads model-manifest.json and, for each model:
 *   - HEADs the upstream HuggingFace resolve URL and compares the content hash (x-linked-etag = sha256)
 *     and repo commit against what we recorded. A mismatch = upstream published a new version → review +
 *     re-run the edmini-ce9 bake-off before swapping.
 *   - HEADs the hosted Blob URL to confirm it's reachable and the size matches (drift / availability).
 *
 * Exit code: 0 if everything matches; 1 if any model has an upstream update, is unreachable, or drifted.
 * Network-only, no secrets (HF + the Blob URL are public). Safe to run in CI or on a schedule.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ModelEntry {
  id: string;
  name: string;
  source: { type: string; repo?: string; resolveUrl: string };
  version: { sha256: string; repoCommit?: string; sizeBytes: number };
  hosted: { url: string };
}

const norm = (etag: string | null): string => (etag ?? "").replace(/^W\//, "").replace(/^"|"$/g, "");

async function headHeaders(url: string, redirect: "manual" | "follow"): Promise<Headers | null> {
  try {
    const res = await fetch(url, { method: "HEAD", redirect });
    return res.headers;
  } catch {
    return null;
  }
}

async function hostedSize(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    const cr = res.headers.get("content-range"); // "bytes 0-0/<total>"
    if (cr && cr.includes("/")) return Number(cr.split("/")[1]);
    const cl = res.headers.get("content-length");
    return cl ? Number(cl) : null;
  } catch {
    return null;
  }
}

async function checkModel(m: ModelEntry): Promise<boolean> {
  let ok = true;
  console.log(`\n● ${m.id} — ${m.name}`);

  // 1. Upstream version (HF resolve URL → 302 carries the LFS metadata headers).
  const up = await headHeaders(m.source.resolveUrl, "manual");
  if (!up) {
    console.log(`  upstream: ✗ unreachable (${m.source.resolveUrl})`);
    ok = false;
  } else {
    const upSha = norm(up.get("x-linked-etag"));
    const upCommit = up.get("x-repo-commit") ?? "";
    const upSize = up.get("x-linked-size") ?? "";
    const shaMatch = upSha && upSha === m.version.sha256;
    console.log(`  upstream sha256:  ${upSha || "(missing)"}  ${shaMatch ? "✓ matches" : "✗ CHANGED"}`);
    if (m.version.repoCommit && upCommit && upCommit !== m.version.repoCommit) {
      console.log(`  upstream commit:  ${upCommit}  (recorded ${m.version.repoCommit}) — repo moved`);
    }
    if (!shaMatch) {
      console.log(`  recorded sha256:  ${m.version.sha256}`);
      console.log(`  → UPSTREAM UPDATE: re-download, re-run the edmini-ce9 bake-off, then re-host + update this manifest.`);
      ok = false;
    }
    if (upSize && Number(upSize) !== m.version.sizeBytes) {
      console.log(`  upstream size:    ${upSize} (recorded ${m.version.sizeBytes})`);
    }
  }

  // 2. Hosted blob still serving the recorded bytes. (HEAD on Vercel Blob omits content-length via fetch,
  // so do a 1-byte Range GET and read the total from content-range: "bytes 0-0/<total>".)
  const size = await hostedSize(m.hosted.url);
  if (size == null) {
    console.log(`  hosted:   ✗ unreachable (${m.hosted.url})`);
    ok = false;
  } else {
    const sizeMatch = size === m.version.sizeBytes;
    console.log(`  hosted:   ✓ reachable, ${size} bytes  ${sizeMatch ? "✓ size matches" : "✗ SIZE DRIFT"}`);
    if (!sizeMatch) ok = false;
  }

  return ok;
}

async function main() {
  const manifestPath = join(process.cwd(), "model-manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { models: ModelEntry[] };
  console.log(`Checking ${manifest.models.length} model(s) from model-manifest.json…`);

  const results = await Promise.all(manifest.models.map(checkModel));
  const allOk = results.every(Boolean);

  console.log(allOk
    ? `\n✓ All models up to date and hosted correctly.`
    : `\n✗ One or more models need attention (see above).`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
