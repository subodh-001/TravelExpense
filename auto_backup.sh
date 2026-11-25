#!/usr/bin/env bash
# ==============================================================================
# TravelExpense VPS Automated Time-Wise Backup (12 AM, 4 PM, 8 PM, 10 PM)
# Retention: Automatically keeps rolling 15 days of backups and deletes older
# ==============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$APP_DIR/backups"
TS="$(date +%Y-%m-%d_%H-%M-%S)"
ARCHIVE="$BACKUP_DIR/TravelExpense_Data_${TS}.tar.gz"

mkdir -p "$BACKUP_DIR"

# Create compressed backup of live data, uploads, and activity logs
tar -czf "$ARCHIVE" \
  -C "$APP_DIR" \
  --ignore-failed-read \
  backend/data/*.json \
  backend/data/*.sqlite* \
  backend/uploads \
  backend/logs 2>/dev/null || true

echo "[$(date '+%Y-%m-%d %H:%M:%S %Z')] Backup created: $ARCHIVE ($(du -h "$ARCHIVE" | cut -f1))"

# 15-Day Rolling Cleanup: Delete backups older than 15 days
find "$BACKUP_DIR" -name "TravelExpense_Data_*.tar.gz" -type f -mtime +15 -delete
find "$APP_DIR/backend/data/backups" -name "*.json" -type f -mtime +15 -delete 2>/dev/null || true
find "$APP_DIR/backend/logs" -name "activity_*.log" -type f -mtime +15 -delete 2>/dev/null || true
