// No-secrets write-time lint (D6e). The brain is git-committed (low-trust), so
// secrets must never land in it. Named, high-signal patterns (low false-positive) —
// not generic entropy. Checked at addEntry; explicit adds throw, passive captures
// skip (handled by the caller).

export interface SecretHit {
  kind: string;
}

const PATTERNS: Array<{ kind: string; re: RegExp }> = [
  { kind: 'private-key-block', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { kind: 'aws-access-key-id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { kind: 'github-token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { kind: 'github-pat', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { kind: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { kind: 'gcp-api-key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  // Azure storage account key (the base64 value in a connection string / SAS) — the
  // highest-likelihood secret for this Azure-ops substrate. AccountKey isn't an
  // api[_-]?key, so the generic assigned-secret rule below misses it.
  { kind: 'azure-storage-key', re: /\bAccountKey=[A-Za-z0-9+/]{30,}={0,2}/ },
  { kind: 'bearer-token', re: /\bBearer\s+[A-Za-z0-9._~+/\-]{20,}=*\b/ },
  {
    kind: 'assigned-secret',
    re: /\b(?:api[_-]?key|secret|token|password|passwd|pwd)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-./+]{16,}/i,
  },
];

export function detectSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const p of PATTERNS) if (p.re.test(text)) hits.push({ kind: p.kind });
  return hits;
}

export function assertNoSecrets(text: string): void {
  const hits = detectSecrets(text);
  if (hits.length > 0) {
    // Never echo the offending text — just the matched kind(s).
    throw new Error(
      `refusing to store: looks like a secret (${hits.map((h) => h.kind).join(', ')}). ` +
        `The brain is git-committed — keep secrets out (D6e).`,
    );
  }
}
