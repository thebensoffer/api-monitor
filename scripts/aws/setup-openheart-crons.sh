#!/usr/bin/env bash
# OpenHeart EventBridge cron installer.
#
# Creates one Lambda + one EventBridge rule per OpenHeart cron, all firing
# HTTP GETs against the deployed OpenHeart instance.
#
# Required env:
#   OPENHEART_URL    Base URL of deployed OpenHeart (e.g. https://openheart.example.com)
#   CRON_SECRET      Shared secret the dispatcher checks
# Optional env:
#   BASIC_AUTH       base64("user:pass") if Amplify basic-auth gate is enabled
#   AWS_REGION       defaults to us-east-1
#
# Usage:
#   OPENHEART_URL=... CRON_SECRET=... ./setup-openheart-crons.sh
#   ./setup-openheart-crons.sh --dry-run     # show what it would do, no changes

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

: "${OPENHEART_URL:?Set OPENHEART_URL to the deployed dashboard base URL}"
: "${CRON_SECRET:?Set CRON_SECRET (must match the deployed env var)}"
REGION="${AWS_REGION:-us-east-1}"
FUNCTION_NAME="openheart-cron"
ROLE_NAME="${FUNCTION_NAME}-role"

# id|schedule
CRONS=(
  "neon-keepalive|rate(5 minutes)"
  "amplify-build-monitor|rate(10 minutes)"
  "aws-quota-monitor|cron(30 11 * * ? *)"
  "cwv-monitor|cron(0 6 ? * MON *)"
  "seo-health|cron(0 5 ? * MON *)"
  "secret-expiration-radar|cron(0 13 * * ? *)"
  "stripe-webhook-watchdog|rate(15 minutes)"
  "email-alert-triage|rate(10 minutes)"
  "backup-verification|cron(30 10 * * ? *)"
  "backup-checksum|cron(0 6 ? * SUN *)"
  "morning-briefing|cron(0 12 * * ? *)"
  "evening-report|cron(0 23 * * ? *)"
  "gsc-snapshot|cron(0 11 ? * MON *)"
  "synthetic-journey|rate(1 hour)"
  "cron-watchdog|rate(1 hour)"
  "aws-cost-monitor|cron(0 13 * * ? *)"
  "failed-payment-watchdog|rate(15 minutes)"
  "sender-reputation|cron(0 14 * * ? *)"
  "integrity-monitor|cron(0 9 * * ? *)"
  "funnel-monitor|cron(0 12 * * ? *)"
  "tfn-verification-watch|rate(2 hours)"
)

run() {
  if (( DRY_RUN )); then
    echo "DRY: $*"
  else
    eval "$@"
  fi
}

# 1. IAM role
echo "▶ IAM role"
run "aws iam create-role \
  --role-name ${ROLE_NAME} \
  --assume-role-policy-document '{
    \"Version\":\"2012-10-17\",
    \"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"Service\":\"lambda.amazonaws.com\"},\"Action\":\"sts:AssumeRole\"}]
  }' 2>/dev/null || true"
run "aws iam attach-role-policy \
  --role-name ${ROLE_NAME} \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole 2>/dev/null || true"
sleep 5

ROLE_ARN=$(aws iam get-role --role-name "${ROLE_NAME}" --query 'Role.Arn' --output text 2>/dev/null || echo "DRY-RUN-ROLE-ARN")

# 2. Tiny Lambda that calls OpenHeart
echo "▶ Lambda payload"
TMP=$(mktemp -d)
cat > "$TMP/index.js" <<'EOF'
exports.handler = async (event) => {
  const url = process.env.OPENHEART_URL;
  const secret = process.env.CRON_SECRET;
  const basicAuth = process.env.BASIC_AUTH; // base64 of "user:pass" if Amplify basic-auth is on
  const cronId = event.cronId;
  if (!cronId) throw new Error('event.cronId is required');
  const target = `${url}/api/cron/${cronId}`;
  const headers = {
    'x-cron-secret': secret,
    'User-Agent': 'OpenHeart-EventBridge/1.0',
  };
  if (basicAuth) headers['Authorization'] = `Basic ${basicAuth}`;
  const res = await fetch(target, { method: 'GET', headers });
  const body = await res.text();
  console.log(`[${cronId}] HTTP ${res.status} — ${body.slice(0, 500)}`);
  if (!res.ok) throw new Error(`Cron ${cronId} returned HTTP ${res.status}: ${body.slice(0, 200)}`);
  return { ok: true, cronId, status: res.status };
};
EOF
( cd "$TMP" && zip -q openheart-cron.zip index.js )

echo "▶ Lambda function"
run "aws lambda create-function \
  --function-name ${FUNCTION_NAME} \
  --runtime nodejs20.x \
  --handler index.handler \
  --role ${ROLE_ARN} \
  --zip-file fileb://${TMP}/openheart-cron.zip \
  --timeout 60 \
  --environment 'Variables={OPENHEART_URL=${OPENHEART_URL},CRON_SECRET=${CRON_SECRET},BASIC_AUTH=${BASIC_AUTH:-}}' \
  --region ${REGION} 2>/dev/null || \
aws lambda update-function-code \
  --function-name ${FUNCTION_NAME} \
  --zip-file fileb://${TMP}/openheart-cron.zip \
  --region ${REGION} 2>/dev/null"
sleep 3
run "aws lambda update-function-configuration \
  --function-name ${FUNCTION_NAME} \
  --environment 'Variables={OPENHEART_URL=${OPENHEART_URL},CRON_SECRET=${CRON_SECRET},BASIC_AUTH=${BASIC_AUTH:-}}' \
  --region ${REGION} 2>/dev/null || true"

LAMBDA_ARN=$(aws lambda get-function --function-name "${FUNCTION_NAME}" --query 'Configuration.FunctionArn' --output text 2>/dev/null || echo "DRY-RUN-LAMBDA-ARN")
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text 2>/dev/null || echo "000000000000")

# 3. One EventBridge rule per cron
echo "▶ EventBridge rules"
for entry in "${CRONS[@]}"; do
  IFS='|' read -r ID SCHED <<<"$entry"
  RULE="${FUNCTION_NAME}-${ID}"
  echo "  · ${RULE}  ${SCHED}"
  run "aws events put-rule \
    --name '${RULE}' \
    --schedule-expression '${SCHED}' \
    --state ENABLED \
    --region ${REGION} >/dev/null"
  run "aws lambda add-permission \
    --function-name ${FUNCTION_NAME} \
    --statement-id '${RULE}' \
    --action lambda:InvokeFunction \
    --principal events.amazonaws.com \
    --source-arn arn:aws:events:${REGION}:${ACCOUNT_ID}:rule/${RULE} \
    --region ${REGION} 2>/dev/null || true"
  # Use a JSON file to avoid bash quoting hell with --targets
  TF=$(mktemp)
  cat > "$TF" <<JSON
[{"Id":"1","Arn":"${LAMBDA_ARN}","Input":"{\"cronId\":\"${ID}\"}"}]
JSON
  run "aws events put-targets --rule '${RULE}' --targets file://${TF} --region ${REGION} >/dev/null"
  rm -f "$TF"
done

rm -rf "$TMP"

echo ""
echo "✅ OpenHeart cron infrastructure installed (${#CRONS[@]} rules)."
echo "   Verify: aws events list-rules --region ${REGION} | grep ${FUNCTION_NAME}"
