// devops-kb Bash mutation gate (PreToolUse, matcher: Bash).
// Posture: AUTO-ALLOW read-only; ASK (force a human prompt) on any mutation or
// anything not confidently read-only. Read-only-runs-free + every-mutation-needs-
// approval, per the devops-kb operating rules. Best-effort denylist — NOT exhaustive;
// the human remains the backstop, so the default for anything uncertain is "ask".
//
// Contract: reads the PreToolUse hook JSON on stdin, emits hookSpecificOutput with
// permissionDecision allow|ask (same shape vtfkb's brain-write gate uses).
import { readFileSync } from 'node:fs';

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: decision, permissionDecisionReason: reason },
  }));
  process.exit(0);
}

let cmd = '';
try {
  const payload = JSON.parse(readFileSync(0, 'utf8') || '{}');
  cmd = payload?.tool_input?.command ?? '';
} catch { /* unparseable: fall through to the safe default below */ }
if (!cmd.trim()) emit('allow', 'devops-kb: empty command');

// 1. Hard mutation / destructive patterns anywhere in the (possibly compound) command.
const DANGER = [
  { re: /\bterraform\s+(apply|destroy|import|taint|untaint|state\s+(rm|mv|push|replace-provider))\b/, why: 'terraform state mutation' },
  { re: /\bansible-playbook\b(?![^\n]*--check)/, why: 'ansible-playbook without --check (apply)' },
  { re: /\bkubectl\s+(apply|create|delete|edit|patch|replace|scale|annotate|label|set|rollout|drain|cordon|uncordon|taint|cp|exec)\b/, why: 'kubectl mutation' },
  { re: /\baz\s+[a-z0-9-]+(\s+[a-z0-9-]+)?\s+(create|delete|update|set|add|remove|start|stop|restart|deallocate|purge|reset|regenerate|renew|assign|enable|disable|attach|detach|move|import|invoke|run|generate|approve|reject|grant|revoke|lock|unlock|wait)\b/, why: 'az write operation' },
  { re: /\b(ssh|scp|sftp)\b/, why: 'remote ssh/scp (can run arbitrary remote changes)' },
  { re: /\brsync\b[^\n]*::?/, why: 'rsync to/from a remote' },
  { re: /\bhelm\s+(install|upgrade|uninstall|delete|rollback)\b/, why: 'helm release mutation' },
  { re: /\bgit\s+push\b/, why: 'git push' },
  { re: /\bdocker\s+(run|rm|rmi|stop|kill|exec|system\s+prune|volume\s+rm)\b/, why: 'docker mutation' },
  { re: /\b(rm|dd|mkfs\S*|shutdown|reboot|truncate|chmod|chown)\b[^\n]*(-[a-z]*r|\/(etc|var|usr|boot|brain))/, why: 'destructive filesystem op' },
  { re: /\bfind\b[^\n]*-delete\b/, why: 'find -delete' },
  { re: /(^|[^>])>\s*\/(etc|var|usr|boot)\//, why: 'redirect into a system path' },
];
for (const d of DANGER) if (d.re.test(cmd)) emit('ask', `devops-kb: ${d.why} — needs approval; dry-run first (plan/--check).`);

// 2. Infra binaries that aren't a recognized read-only subcommand -> ask (catches novel
//    write verbs the denylist above doesn't enumerate).
const INFRA = [
  { bin: /\bterraform\b/, ro: /\bterraform\s+(plan|show|output|state\s+(list|show)|validate|fmt|version|providers|init|get|graph|console|workspace\s+(list|show))\b/ },
  { bin: /\baz\b/, ro: /\baz\s+([a-z0-9-]+\s+)*(show|list|list-[a-z-]+|get|get-[a-z-]+|check[a-z-]*|exists|version|graph|search)\b|\baz\s+account\b|\baz\s+(login|logout|configure|cloud\s+(list|show))\b/ },
  { bin: /\bkubectl\b/, ro: /\bkubectl\s+(get|describe|logs|top|version|api-resources|api-versions|explain|cluster-info|config\s+(view|current-context|get-[a-z-]+)|auth\s+can-i|diff)\b/ },
  { bin: /\b(ansible|ansible-playbook|ansible-inventory)\b/, ro: /--check\b|\bansible-inventory\b|\bansible\s+[^\n]*-m\s+(setup|ping|debug)\b/ },
  { bin: /\bhelm\b/, ro: /\bhelm\s+(list|status|get|show|history|template|search|version|repo\s+(list|update))\b/ },
];
for (const i of INFRA) if (i.bin.test(cmd) && !i.ro.test(cmd)) emit('ask', 'devops-kb: infra command not recognized as read-only — needs approval.');

// 3. Everything else (general shell, recognized read-only infra) runs free.
emit('allow', 'devops-kb: read-only / non-infra');
