#!/bin/bash
# Claude Code launcher for ttyd terminal sessions
# This script runs inside the ttyd web terminal

export HOME=/data
export TERM=xterm-256color
export LANG=C.UTF-8
export LC_ALL=C.UTF-8
cd /data/workspace

echo "╔══════════════════════════════════════════════════╗"
echo "║          Claude Code for Home Assistant          ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Commands:                                      ║"
echo "║    claude           — New session                ║"
echo "║    claude -c         — Continue last session      ║"
echo "║    claude --resume   — Pick a session to resume   ║"
echo "║    exit             — Close terminal             ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# Auto-continue last session if one exists, otherwise start new
claude -c 2>/dev/null || claude

# If claude exits, drop to bash so the terminal stays open
echo ""
echo "Claude Code exited. Type 'claude' to start a new session, or 'claude --resume' to resume one."
exec bash
