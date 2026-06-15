# vtfkb container dogfood — a clean-room Claude Code session in the deployment-shaped
# image (node:20-slim, a faithful proxy for the node-based vafi-developer agent image).
#
# Isolation is automatic: a fresh container HOME has NO /home/jasonvi/CLAUDE.md, no
# global ~/.claude.json MCP servers, no mykb auto-memory, no kb on PATH, no bashrc
# funcs, no skills. Only what is baked or mounted here exists. --strict-mcp-config at
# run time is defense-in-depth on top of that.
#
# Two faces wired simultaneously:
#   - MCP   (mcp-config.json -> dist/mcp-server.js): active pull/search/map tools.
#   - hooks (settings.json   -> dist/cli.js):        SessionStart Tier-A inject +
#                                                     Post/PreToolUse capture + brain-write gate.
FROM node:20-slim

# 1. The agent runtime. Pinned to the host's version (2.1.162).
RUN npm install -g @anthropic-ai/claude-code@2.1.162

# 2. vtfkb substrate: built artifact + the single runtime dep (@modelcontextprotocol/sdk,
#    needed only by the MCP face; the cli/hooks face is dependency-free).
WORKDIR /opt/vtfkb
COPY dist/ ./dist/
COPY package.json ./
RUN npm install --omit=dev

# 3. Clean-room config (vtfkb-only; ZERO mykb).
COPY spike/dogfood/mcp-config.json spike/dogfood/settings.json ./
COPY spike/dogfood/CLAUDE.md /work/CLAUDE.md

# 4. Writable HOME for the agent (claude writes ~/.claude/*). Host uid is set with
#    --user at run time; 0777 on the image-created HOME dirs avoids the uid-mismatch
#    silent-write-failure on bind mounts. The repo (/work/vtfkb) and brain (/brain)
#    mounts are owned by the host uid that --user matches.
RUN mkdir -p /work/.claude /brain && chmod -R 0777 /work /brain

ENV HOME=/work VTFKB_DIR=/brain VTFKB_PROJECT=vtfkb-dogfood
WORKDIR /work/vtfkb
