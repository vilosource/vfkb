// Strict CLI argument parsing (issue #95 — the silent-flag family).
// Every verb declares its flags; anything unknown or repeated ERRORS instead of
// being silently ignored. The `hook` subcommands are intentionally NOT parsed
// through this — the harness hook contract is fail-open (a hook must never
// wedge a session over an argv quirk).

export type FlagKind =
  | 'value' // --name <value>            (value required)
  | 'boolean' // --name                    (no value; never consumes the next arg)
  | 'optional-value'; // --name [value]  (consumes the next arg unless it is another flag)

export type FlagSpec = Readonly<Record<string, FlagKind>>;

export interface ParsedArgs {
  /** Non-flag args in order (verb text, ids, project names …). */
  positionals: string[];
  flags: Map<string, string | true>;
}

/** A user-facing argv mistake — the CLI prints the message + usage and exits 1. */
export class UsageError extends Error {}

export function parseArgs(verb: string, args: string[], spec: FlagSpec): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('--')) {
      positionals.push(a);
      continue;
    }
    const name = a.slice(2);
    const kind = spec[name];
    if (!kind) {
      throw new UsageError(`unknown flag --${name} for '${verb}'${didYouMean(name, spec)}${knownFlags(spec)}`);
    }
    if (flags.has(name)) {
      throw new UsageError(
        `repeated flag --${name} for '${verb}' — give it once` +
          (kind === 'value' ? ` (use a comma-separated value for multiples, e.g. --${name} a,b)` : ''),
      );
    }
    if (kind === 'boolean') {
      flags.set(name, true);
      continue;
    }
    const next = args[i + 1];
    if (next === undefined || next.startsWith('--')) {
      if (kind === 'optional-value') {
        flags.set(name, true);
        continue;
      }
      throw new UsageError(`flag --${name} for '${verb}' requires a value`);
    }
    flags.set(name, next);
    i++;
  }
  return { positionals, flags };
}

/** String value of a flag, if given with one. */
export function flagValue(p: ParsedArgs, name: string): string | undefined {
  const v = p.flags.get(name);
  return typeof v === 'string' ? v : undefined;
}

/** Comma-separated flag → trimmed non-empty list (undefined when absent). */
export function flagList(p: ParsedArgs, name: string): string[] | undefined {
  const v = flagValue(p, name);
  if (v === undefined) return undefined;
  return v.split(',').map((t) => t.trim()).filter(Boolean);
}

/** Positive-integer flag; errors on anything else (silent NaN was the old behavior). */
export function flagInt(p: ParsedArgs, verb: string, name: string): number | undefined {
  const v = flagValue(p, name);
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v) || Number(v) < 1) {
    throw new UsageError(`flag --${name} for '${verb}' must be a positive integer (got '${v}')`);
  }
  return Number(v);
}

function didYouMean(name: string, spec: FlagSpec): string {
  // The observed trap: --tags for --tag (four real entries landed untagged).
  const singular = name.replace(/s$/, '');
  if (singular !== name && spec[singular]) return ` — did you mean --${singular} a,b (comma-separated)?`;
  return '';
}

function knownFlags(spec: FlagSpec): string {
  const names = Object.keys(spec);
  return names.length ? ` (known: ${names.map((n) => `--${n}`).join(', ')})` : ' (it takes no flags)';
}
