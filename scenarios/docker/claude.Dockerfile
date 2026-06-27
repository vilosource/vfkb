# T5b — claude-code L4 harness image (ADR-0022).
# The claude/Anthropic counterpart of pi.Dockerfile: a pinned, self-contained sandbox
# for the L4 purpose harness's `claude` path. The node L4 runner shells `docker run`
# against this image instead of host `claude`, so a record pins the image digest.
#
# The container is the sandbox: no host FS, no host MCP servers, no operator files.
# The ONE secret it sees is the Claude subscription OAuth credential — a per-run COPY
# of ~/.claude/.credentials.json's `claudeAiOauth` block, mounted at /work/.claude at
# run time (operator decision 2026-06-27: use the Claude Code Max subscription, NOT an
# ANTHROPIC_API_KEY — none is set on this host). The copy is throwaway so a container-
# side token refresh never disturbs the host session's live credential.
FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# Claude Code — PINNED to the host version for digest-stable behavior.
RUN npm install -g @anthropic-ai/claude-code@2.1.195

# vtfkb substrate: built artifact + its one prod dep. NO native build.
WORKDIR /opt/vtfkb
COPY dist/ ./dist/
COPY package.json ./
RUN npm install --omit=dev

# Writable HOME + brain mountpoint for an arbitrary host uid (--user $(id -u):$(id -g)
# at run time). /work/.claude is the mount point for the per-run credential copy; 0777
# so the uid-matched container can read the creds and write claude's runtime state, and
# so the agent's brain writes persist to the host-bind-mounted /brain.
RUN mkdir -p /work/.claude /brain && chmod -R 0777 /work /brain
# Empty top-level config so claude doesn't warn about a missing /work/.claude.json (the
# subscription credential lives in the mounted /work/.claude/.credentials.json, separate).
RUN echo '{}' > /work/.claude.json && chmod 0666 /work/.claude.json

ENV HOME=/work VTFKB_DIR=/brain VTFKB_PROJECT=l4
WORKDIR /brain
