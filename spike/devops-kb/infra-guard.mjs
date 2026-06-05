// devops-kb infra mutation gate — the PI face of the safety layer (parity with the
// Claude bash-guard.mjs PreToolUse hook). pi has NO native tool-approval system
// (its ToolExecutionMode is just sequential|parallel — it auto-runs bash), so this
// extension IS the gate.
//
// Posture (same as bash-guard): AUTO-ALLOW read-only / non-infra; on any mutation or
// anything not confidently read-only, force an operator decision. In interactive mode
// that's a ctx.ui.confirm() prompt; with no UI (headless -p) the default is BLOCK —
// fail safe, never silently apply. Best-effort denylist — the human is the backstop.
//
// Load like any pi extension:  pi -e spike/devops-kb/infra-guard.mjs
// It registers a `tool_call` handler that gates the built-in `bash` tool only
// (mutations land through bash: terraform apply, az writes, kubectl mutations, ssh…);
// the vtfkb pi-extension separately gates brain-file writes. They compose.

// Hard mutation / destructive patterns anywhere in the (possibly compound) command.
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

// Infra binaries that aren't a recognized read-only subcommand -> gate (catches novel
// write verbs the denylist above doesn't enumerate).
const INFRA = [
  { bin: /\bterraform\b/, ro: /\bterraform\s+(plan|show|output|state\s+(list|show)|validate|fmt|version|providers|init|get|graph|console|workspace\s+(list|show))\b/ },
  { bin: /\baz\b/, ro: /\baz\s+([a-z0-9-]+\s+)*(show|list|list-[a-z-]+|get|get-[a-z-]+|check[a-z-]*|exists|version|graph|search)\b|\baz\s+account\b|\baz\s+(login|logout|configure|cloud\s+(list|show))\b/ },
  { bin: /\bkubectl\b/, ro: /\bkubectl\s+(get|describe|logs|top|version|api-resources|api-versions|explain|cluster-info|config\s+(view|current-context|get-[a-z-]+)|auth\s+can-i|diff)\b/ },
  { bin: /\b(ansible|ansible-playbook|ansible-inventory)\b/, ro: /--check\b|\bansible-inventory\b|\bansible\s+[^\n]*-m\s+(setup|ping|debug)\b/ },
  { bin: /\bhelm\b/, ro: /\bhelm\s+(list|status|get|show|history|template|search|version|repo\s+(list|update))\b/ },
];

// Returns a reason string when the command must be gated, or null to allow.
export function classify(cmd) {
  if (!cmd || !cmd.trim()) return null;
  for (const d of DANGER) if (d.re.test(cmd)) return d.why;
  for (const i of INFRA) if (i.bin.test(cmd) && !i.ro.test(cmd)) return 'infra command not recognized as read-only';
  return null;
}

export default function (pi) {
  pi.on('tool_call', async (event, ctx) => {
    if (event?.toolName !== 'bash') return undefined;
    const cmd = event?.input?.command ?? '';
    const why = classify(cmd);
    if (!why) return undefined; // read-only / non-infra -> runs free

    // Headless / no UI: fail safe. Never silently apply a mutation without a human.
    if (!ctx?.hasUI) {
      return { block: true, reason: `devops-kb gate: ${why} — blocked (no interactive approval available). Dry-run first (plan/--check) and run with an operator present.` };
    }

    const approved = await ctx.ui.confirm(
      'devops-kb — approve mutation?',
      `${why}\n\n$ ${cmd}\n\nDry-run first (plan / --check) — the dry-run output is the verification. Approve this command?`,
    );
    return approved
      ? undefined
      : { block: true, reason: `devops-kb gate: operator DECLINED "${why}". Dry-run (plan/--check), present it, and ask again.` };
  });
}
