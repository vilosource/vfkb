# T5a — pi-coding L4 harness image (ADR-0022).
# A pinned, self-contained sandbox for the L4 purpose harness's `pi`/deepseek path.
# The node L4 runner (scenarios/l4-purpose.mjs) shells `docker run` against this image
# instead of the host `pi`, so a record pins the image digest and a re-run reproduces.
#
# The container is the sandbox: no host FS, no host creds, no host ~/.pi or global MCP.
# The only secret it sees is DEEPSEEK_TOKEN (the model API key), injected at run time.
#
# Reproducibility: pi is pinned; the vtfkb substrate is the BUILT dist baked in (the same
# pi-extension.js / pi-mcp-bridge.js / mcp-server.js the host harness loads via `-e`).
FROM node:20-slim

# Single runtime dep of the MCP server/bridge (@modelcontextprotocol/sdk); git is handy
# for any in-container CLI that probes a repo. No build toolchain — vtfkb has no native dep.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

# pi (the deepseek-driving agent) — PINNED to the host version for digest-stable behavior.
RUN npm install -g @mariozechner/pi-coding-agent@0.73.1

# vtfkb substrate: built artifact + its one prod dep. NO native build.
WORKDIR /opt/vtfkb
COPY dist/ ./dist/
COPY package.json ./
RUN npm install --omit=dev

# Provider config the agent reads from $HOME/.pi/agent/models.json. Only the deepseek
# provider is baked; its apiKey field names the DEEPSEEK_TOKEN env var (pi recipe:
# apiKey = ENV VAR NAME, not the literal) supplied at run time.
COPY scenarios/docker/models.json /work/.pi/agent/models.json

# Writable HOME + brain mountpoint for an arbitrary host uid (--user $(id -u):$(id -g)
# at run time). 0777 on image-created dirs avoids the silent-write-fail-on-uid-mismatch
# gotcha: the agent's brain writes (entries.jsonl, .sessions/<id>.json) MUST persist to
# the host-bind-mounted /brain so cross-session scenarios carry state across containers.
RUN mkdir -p /work/.pi /brain && chmod -R 0777 /work /brain

ENV HOME=/work VTFKB_DIR=/brain VTFKB_PROJECT=l4
WORKDIR /brain
