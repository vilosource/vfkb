# devops-kb — tooled Azure-ops container with the vfkb knowledge substrate.
# A clean-room Claude Code session (isolated from mykb) that carries real infra
# tooling + access and a seeded devops-kb brain. node:20-slim base (the claude + vfkb
# faces are node); infra toolchain layered on top.
FROM node:20-slim

# OS tooling: python (ansible), ssh/git, download/dns utilities.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg git openssh-client unzip jq \
      python3 python3-pip python3-venv dnsutils iputils-ping \
    && rm -rf /var/lib/apt/lists/*

# Azure CLI (official Debian package).
RUN curl -sL https://aka.ms/InstallAzureCLIDeb | bash

# kubectl (current stable).
RUN curl -sLO "https://dl.k8s.io/release/$(curl -sL https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl" \
    && install -m 0755 kubectl /usr/local/bin/kubectl && rm -f kubectl

# glab (GitLab CLI) — lets the agent DISCOVER project paths/namespaces itself (the
# Optiscan GitLab nests subgroups) instead of guessing or asking. Pinned to match host.
RUN curl -sL "https://gitlab.com/gitlab-org/cli/-/releases/v1.90.0/downloads/glab_1.90.0_linux_amd64.tar.gz" \
      | tar xz -C /tmp bin/glab \
    && install -m 0755 /tmp/bin/glab /usr/local/bin/glab && rm -rf /tmp/bin

# terraform via tfenv — honors each repo's .terraform-version (avoids state-upgrade
# surprises from a single pinned binary across many service-group repos).
RUN git clone --depth 1 https://github.com/tfutils/tfenv.git /opt/tfenv \
    && ln -s /opt/tfenv/bin/tfenv /opt/tfenv/bin/terraform /usr/local/bin/ \
    && tfenv install latest && tfenv use latest

# ansible (pip in a venv; PEP-668-safe), exposed on PATH.
RUN python3 -m venv /opt/ansible \
    && /opt/ansible/bin/pip install --no-cache-dir ansible \
    && ln -s /opt/ansible/bin/ansible /opt/ansible/bin/ansible-playbook \
             /opt/ansible/bin/ansible-galaxy /opt/ansible/bin/ansible-inventory /usr/local/bin/

# Agent runtimes — both faces in one image: Claude Code and pi (the latter drives the
# GitHub Copilot Claude Haiku 4.5 path; the launchers pick which one).
RUN npm install -g @anthropic-ai/claude-code@2.1.162 \
                   @mariozechner/pi-coding-agent@0.73.1

# vfkb substrate: built artifact + the single runtime dep (@modelcontextprotocol/sdk).
WORKDIR /opt/vfkb
COPY dist/ ./dist/
COPY package.json ./
RUN npm install --omit=dev

# Clean-room config (devops-kb; ZERO mykb).
#   Claude face: settings.json (hooks) + bash-guard.mjs + /work/CLAUDE.md (operating rules)
#   pi face:     infra-guard.mjs (mutation gate) + operating-rules.md (--append-system-prompt)
#   shared:      mcp-config.json (the vfkb MCP server; pi reads it via VFKB_MCP_CONFIG)
COPY spike/devops-kb/mcp-config.json spike/devops-kb/settings.json spike/devops-kb/bash-guard.mjs \
     spike/devops-kb/infra-guard.mjs spike/devops-kb/operating-rules.md ./
COPY spike/devops-kb/CLAUDE.md /work/CLAUDE.md
# Rewrite Optiscan GitLab HTTPS URLs to SSH (HTTPS can't auth in here; SSH is wired).
COPY spike/devops-kb/gitconfig /work/.gitconfig

# Writable HOME for the agent (claude + az write here). Host uid set with --user at
# run time; 0777 on image-created dirs avoids uid-mismatch silent write failures.
# Mounts land at: /work/.azure, /work/.claude, /brain (seeded), /gitlab (repos).
RUN mkdir -p /work/.claude /work/.azure /brain /gitlab && chmod -R 0777 /work /brain /gitlab

ENV HOME=/work VFKB_DIR=/brain VFKB_PROJECT=devops-kb
WORKDIR /gitlab
