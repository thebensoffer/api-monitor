#!/usr/bin/env bash
# Delete the legacy `discreet-ketamine-cron-*` and `discreet-ketamine-*-cron`
# EventBridge rules that are duplicated by the newer `dk-cron-*` rules.
#
# Defaults to DRY RUN — must pass --apply to actually delete.
#
# Usage:
#   ./cleanup-dk-duplicate-rules.sh             # show what would be deleted
#   ./cleanup-dk-duplicate-rules.sh --apply     # actually delete

set -euo pipefail

REGION="${AWS_REGION:-us-east-1}"
APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1

# Legacy rules confirmed duplicated by dk-cron-* equivalents.
# (Verified against `aws events list-rules` output 2026-04-18.)
LEGACY_RULES=(
  "discreet-ketamine-cron-ab-testing"             # → dk-cron-ab-testing-rule
  "discreet-ketamine-birthday-cron"               # → dk-cron-birthday-emails-rule
  "discreet-ketamine-cron-birthday"               # → dk-cron-birthday-emails-rule
  "discreet-ketamine-cron-check-package-expirations"   # → dk-cron-check-package-expirations-rule
  "discreet-ketamine-cron-check-pending-rx"       # → dk-cron-check-pending-rx-rule
  "discreet-ketamine-cron-evening-report"         # → covered by dk-cron-morning-report + new evening rule
  "discreet-ketamine-cron-gsc-snapshot"           # → dk-cron-gsc-snapshot-rule
  "discreet-ketamine-cron-newsletter-send"        # → dk-cron-newsletter-send-rule
  "discreet-ketamine-cron-package-renewal"        # → dk-cron-package-renewal-rule
  "discreet-ketamine-cron-prescription-renewal"   # → dk-cron-prescription-renewal-rule
  "discreet-ketamine-cron-process-emails"         # → dk-cron-process-email-sequences-rule
  "discreet-ketamine-appointment-reminders"       # → dk-cron-appointment-reminders-rule
  "discreet-ketamine-cron-reminders"              # → dk-cron-appointment-reminders-rule
  "discreet-ketamine-cron-seo-health"             # → dk-cron-seo-health-rule
  "discreet-ketamine-cron-session-cleanup"        # → dk-cron-session-cleanup-rule
  "discreet-ketamine-eligibility-reminder"        # → dk-cron-eligibility-reminder-rule
  "discreet-ketamine-cron-backup-verification"    # superseded by Tovani's backup rules + new OpenHeart cron
)

echo "Region: ${REGION}"
if (( APPLY )); then
  echo "Mode:   APPLY  (will actually delete)"
else
  echo "Mode:   DRY RUN  (no changes; pass --apply to delete)"
fi
echo ""

count_existing=0
count_missing=0
count_unmatched_replacement=0

for RULE in "${LEGACY_RULES[@]}"; do
  EXISTS=$(aws events list-rules --name-prefix "${RULE}" --region "${REGION}" \
             --query "Rules[?Name=='${RULE}'].Name" --output text 2>/dev/null || echo "")
  if [[ -z "${EXISTS}" ]]; then
    printf "  · %-55s [missing - skip]\n" "${RULE}"
    ((count_missing++))
    continue
  fi

  # Confirm a dk-cron-* replacement rule exists before deleting.
  STEM=$(echo "${RULE}" | sed -E 's/^discreet-ketamine-(cron-)?//; s/-cron$//')
  REPLACEMENT=$(aws events list-rules --name-prefix "dk-cron-" --region "${REGION}" \
                  --query "Rules[?contains(Name, \`${STEM}\`)].Name | [0]" \
                  --output text 2>/dev/null || echo "")

  if [[ -z "${REPLACEMENT}" || "${REPLACEMENT}" == "None" ]]; then
    printf "  ⚠ %-55s [NO replacement found — keeping]\n" "${RULE}"
    ((count_unmatched_replacement++))
    continue
  fi

  printf "  ✗ %-55s → replaced by %s\n" "${RULE}" "${REPLACEMENT}"
  ((count_existing++))

  if (( APPLY )); then
    # Must remove targets before deleting rule
    TARGETS=$(aws events list-targets-by-rule --rule "${RULE}" --region "${REGION}" \
                --query 'Targets[].Id' --output text 2>/dev/null || echo "")
    if [[ -n "${TARGETS}" ]]; then
      aws events remove-targets --rule "${RULE}" --ids ${TARGETS} \
        --region "${REGION}" --no-cli-pager >/dev/null 2>&1 || true
    fi
    aws events delete-rule --name "${RULE}" --region "${REGION}" --no-cli-pager >/dev/null 2>&1 \
      && echo "      deleted" \
      || echo "      delete failed (may be in use)"
  fi
done

echo ""
echo "Summary:"
echo "  to delete:                ${count_existing}"
echo "  already missing:          ${count_missing}"
echo "  no replacement (kept):    ${count_unmatched_replacement}"
echo ""
if (( ! APPLY )) && (( count_existing > 0 )); then
  echo "→ Run again with --apply to delete the ${count_existing} duplicate rule(s)."
fi
