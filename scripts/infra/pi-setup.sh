#!/bin/bash

# Raspberry Pi 5 initial setup — installs Docker + UFW firewall rules.
# Run as root or with sudo on the Pi.
# Usage: sudo bash pi-setup.sh

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: Run this script with sudo"
  exit 1
fi

echo "=== Installing Docker ==="

# Docker's official install script handles Ubuntu on ARM64
curl -fsSL https://get.docker.com | bash

# Let the main user run docker without sudo
MAIN_USER="${SUDO_USER:-$(logname)}"
usermod -aG docker "$MAIN_USER"

echo "=== Docker installed ==="
docker --version
docker compose version

echo "=== Configuring UFW ==="

# Reset to clean state
ufw --force reset

# Default: deny inbound, allow outbound (tunnels connect outbound)
ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp comment "SSH"

# PostgreSQL (port forwarded, direct TCP)
ufw allow 5433/tcp comment "PostgreSQL"

# MongoDB (port forwarded, direct TCP)
ufw allow 27018/tcp comment "MongoDB"

# Enable firewall
ufw --force enable

echo "=== UFW status ==="
ufw status verbose

echo ""
echo "=== Setup complete ==="
echo "Log out and back in for docker group to take effect, or run:"
echo "  newgrp docker"
