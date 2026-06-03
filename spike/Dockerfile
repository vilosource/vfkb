# Phase-0 container deployment proof.
# Retires mykb's worst lesson (L6/L7/§1): native compile in-container + extension
# loading. vtfkb has ZERO runtime deps, so the proof is: drop the built dist into a
# clean node image with NO npm install / NO native build, and both faces load + run.
# node:20-slim is a faithful proxy for the vafi-developer agent images (all node-based:
# Pi and Claude Code CLIs are node).
FROM node:20-slim
WORKDIR /vtfkb
# Only the built artifact + manifest. NO node_modules, NO install step.
COPY dist/ ./dist/
COPY package.json ./
ENV VTFKB_DIR=/brain
ENTRYPOINT ["bash", "-lc"]
