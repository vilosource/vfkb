// ============================================================================
// The docker claude arm's argv and output parsing (vfkb#423), kept pure so a
// unit test can pin them (test/docker-claude.test.ts).
//
// CREDENTIAL: the container gets the Claude Code ACCESS token only, by NAME
// (`-e CLAUDE_CODE_OAUTH_TOKEN`); docker copies the value from the docker
// child's own env, so it never appears in argv, `ps` or a record. No
// `.credentials.json` is staged and nothing is mounted at <home>/.claude: a
// staged refresh token could be rotated by a container-side refresh, out from
// under the operator's live session (brain gotcha 4bceb1a993c2). The caller
// builds the docker child's env with claude-auth.mjs's claudeEnv().
// ============================================================================

export const TOKEN_ENV = 'CLAUDE_CODE_OAUTH_TOKEN';

/**
 * argv for `docker run … <image> claude <claudeArgs>`. Adds `--output-format json`
 * so the run reports the model that actually answered (parseClaudeJson).
 */
export function dockerClaudeArgv({ uid, gid, home, brainHost, brainC, sessionId, image, claudeArgs }) {
  const argv = ['run', '--rm', '--user', `${uid}:${gid}`,
    '-e', `HOME=${home}`,
    '-e', `VFKB_DIR=${brainC}`,
    '-e', 'VFKB_PROJECT=l4',
    '-e', TOKEN_ENV];
  // Thread KB_SESSION_ID into the hooks' env so SessionState persists a record under
  // the /brain mount (cross-session continuity scenarios). Without it SessionState is
  // ephemeral and nothing carries to the next container.
  if (sessionId) argv.push('-e', `KB_SESSION_ID=${sessionId}`);
  argv.push('-v', `${brainHost}:${brainC}`, image, 'claude', ...claudeArgs, '--output-format', 'json');
  return argv;
}

/**
 * `claude -p --output-format json` stdout → { text, models }. text is the `result`
 * field (what the scenarios score; '' when an error result carries none); models are
 * the `modelUsage` keys. The JSON object is the last stdout line that parses, so a
 * warning printed before it does not hide it. Output with no such object passes
 * through as text with no models: the caller treats "no model answered" as a harness
 * fault, never as a model observation (vfkb#423).
 */
export function parseClaudeJson(stdout) {
  const raw = String(stdout ?? '').trim();
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  for (const candidate of [raw, ...lines.reverse()]) {
    let j;
    try { j = JSON.parse(candidate); } catch { continue; }
    if (j && typeof j === 'object' && !Array.isArray(j)) {
      return {
        text: typeof j.result === 'string' ? j.result : '',
        models: Object.keys(j.modelUsage || {}),
      };
    }
  }
  return { text: raw, models: [] };
}
