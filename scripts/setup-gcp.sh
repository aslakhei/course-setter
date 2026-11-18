#!/usr/bin/env bash
# One-time Google Cloud setup for deploying the worker to Cloud Run from GitHub Actions.
# Safe to run again: existing resources are kept.
#
# Run it in Cloud Shell (https://shell.cloud.google.com, gcloud is already signed in) as a project owner:
#   git clone https://github.com/aslakhei/course-setter && cd course-setter
#   PROJECT_ID=<your project id> bash scripts/setup-gcp.sh
#
# Billing must be enabled on the project first (Cloud Run requires it, even within the free tier).
# It asks for the Supabase secret key (hidden input) and generates the worker's shared secret.
#
# Budget: a monthly budget (default 1 unit of the billing account's currency, counted after the free tier)
# whose notifications go to the budget-guard service, which cuts off the worker once cost reaches it.
# To raise it later, run again with BUDGET_AMOUNT, e.g. BUDGET_AMOUNT=50 PROJECT_ID=... bash scripts/setup-gcp.sh
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID to the Google Cloud project id}"
REGION=europe-north1
GITHUB_REPO=aslakhei/course-setter # the only repository allowed to deploy
AR_REPO=course-setter

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
WORKER_SA="worker@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOY_SA="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"
GUARD_SA="budget-guard@$PROJECT_ID.iam.gserviceaccount.com"
# Cloud Run's deterministic URL for the budget-guard service (it is deployed by GitHub Actions).
GUARD_URL="https://budget-guard-$PROJECT_NUMBER.$REGION.run.app"
POOL="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github"

exists() { "$@" >/dev/null 2>&1; }

echo "== APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com \
  pubsub.googleapis.com cloudbilling.googleapis.com billingbudgets.googleapis.com

echo "== Artifact Registry (worker images; only recent ones are kept)"
exists gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION" \
    --description "Worker images"
policy=$(mktemp)
cat >"$policy" <<'JSON'
[
  { "name": "keep-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 2 } },
  { "name": "delete-old", "action": { "type": "Delete" }, "condition": { "olderThan": "7d" } }
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" --policy "$policy" --no-dry-run >/dev/null
rm -f "$policy"

echo "== Service accounts"
exists gcloud iam service-accounts describe "$WORKER_SA" ||
  gcloud iam service-accounts create worker --display-name "Course-setter worker (Cloud Run runtime)"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create github-deploy --display-name "GitHub Actions deploy"
exists gcloud iam service-accounts describe "$GUARD_SA" ||
  gcloud iam service-accounts create budget-guard --display-name "Budget guard (cuts off the worker)"

# The deploy account may manage Cloud Run, push images and run the services as the worker and
# budget-guard accounts.
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/run.admin --condition None >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer >/dev/null
for sa in "$WORKER_SA" "$GUARD_SA"; do
  gcloud iam service-accounts add-iam-policy-binding "$sa" --member "serviceAccount:$DEPLOY_SA" \
    --role roles/iam.serviceAccountUser >/dev/null
done

# The budget guard may only read and replace who can call Cloud Run services (to remove public access
# to the worker), and call Cloud Run services (it is the identity Pub/Sub pushes to budget-guard with).
exists gcloud iam roles describe budgetGuard --project "$PROJECT_ID" ||
  gcloud iam roles create budgetGuard --project "$PROJECT_ID" --title "Budget guard" \
    --permissions run.services.getIamPolicy,run.services.setIamPolicy >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$GUARD_SA" \
  --role "projects/$PROJECT_ID/roles/budgetGuard" --condition None >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$GUARD_SA" \
  --role roles/run.invoker --condition None >/dev/null

echo "== Workload Identity Federation (GitHub Actions on main of $GITHUB_REPO, no keys)"
exists gcloud iam workload-identity-pools describe github --location global ||
  gcloud iam workload-identity-pools create github --location global --display-name GitHub
exists gcloud iam workload-identity-pools providers describe course-setter --location global --workload-identity-pool github ||
  gcloud iam workload-identity-pools providers create-oidc course-setter --location global \
    --workload-identity-pool github --display-name "course-setter repo" \
    --issuer-uri https://token.actions.githubusercontent.com \
    --attribute-mapping "google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref" \
    --attribute-condition "assertion.repository == '$GITHUB_REPO' && assertion.ref == 'refs/heads/main'"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA" --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/$POOL/attribute.repository/$GITHUB_REPO" >/dev/null

echo "== Secrets (Secret Manager, readable only by the worker account)"
for secret in supabase-secret-key worker-secret; do
  exists gcloud secrets describe "$secret" || gcloud secrets create "$secret" --replication-policy automatic
  gcloud secrets add-iam-policy-binding "$secret" --member "serviceAccount:$WORKER_SA" \
    --role roles/secretmanager.secretAccessor >/dev/null
done
if ! exists gcloud secrets versions access latest --secret supabase-secret-key; then
  read -rsp "Supabase secret key (dashboard -> Project Settings -> API Keys -> Secret keys): " key
  echo
  printf %s "$key" | gcloud secrets versions add supabase-secret-key --data-file=- >/dev/null
fi
if ! exists gcloud secrets versions access latest --secret worker-secret; then
  openssl rand -hex 32 | tr -d '\n' | gcloud secrets versions add worker-secret --data-file=- >/dev/null
fi

echo "== Budget and kill switch"
# Pub/Sub signs its push requests as the budget-guard account.
gcloud iam service-accounts add-iam-policy-binding "$GUARD_SA" --role roles/iam.serviceAccountTokenCreator \
  --member "serviceAccount:service-$PROJECT_NUMBER@gcp-sa-pubsub.iam.gserviceaccount.com" >/dev/null
exists gcloud pubsub topics describe budget-alerts || gcloud pubsub topics create budget-alerts
exists gcloud pubsub subscriptions describe budget-guard ||
  gcloud pubsub subscriptions create budget-guard --topic budget-alerts \
    --push-endpoint "$GUARD_URL/" --push-auth-service-account "$GUARD_SA" --push-auth-token-audience "$GUARD_URL" \
    --ack-deadline 60 --message-retention-duration 1d --min-retry-delay 10s --max-retry-delay 600s

BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingAccountName)')
BILLING_ACCOUNT=${BILLING_ACCOUNT#billingAccounts/}
[ -n "$BILLING_ACCOUNT" ] || { echo "Billing is not enabled on $PROJECT_ID; enable it and run again." >&2; exit 1; }
CURRENCY=$(gcloud billing accounts describe "$BILLING_ACCOUNT" --format='value(currencyCode)')
budget_flags=(--billing-account "$BILLING_ACCOUNT" --billing-project "$PROJECT_ID")
BUDGET=$(gcloud billing budgets list "${budget_flags[@]}" --filter 'displayName=course-setter' --format 'value(name)' | head -1)
if [ -z "$BUDGET" ]; then
  gcloud billing budgets create "${budget_flags[@]}" --display-name course-setter \
    --budget-amount "${BUDGET_AMOUNT:-1}$CURRENCY" --calendar-period month --filter-projects "projects/$PROJECT_ID" \
    --threshold-rule percent=0.5 --threshold-rule percent=0.9 --threshold-rule percent=1.0 \
    --notifications-rule-pubsub-topic "projects/$PROJECT_ID/topics/budget-alerts" >/dev/null
elif [ -n "${BUDGET_AMOUNT:-}" ]; then
  gcloud billing budgets update "$BUDGET" "${budget_flags[@]}" --budget-amount "$BUDGET_AMOUNT$CURRENCY" >/dev/null
fi
gcloud billing budgets list "${budget_flags[@]}" --filter 'displayName=course-setter' \
  --format 'value(amount.specifiedAmount.units, amount.specifiedAmount.currencyCode)' | sed 's/^/Monthly budget: /'

cat <<EOF

Done. Set these GitHub repository variables (not secrets; they are not sensitive), e.g. with gh:

gh variable set GCP_PROJECT_ID --body "$PROJECT_ID"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "$POOL/providers/course-setter"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --body "$DEPLOY_SA"
gh variable set GCP_WORKER_SERVICE_ACCOUNT --body "$WORKER_SA"

The next deploy from main then creates the Cloud Run services (worker and budget-guard). The worker URL:
  gcloud run services describe worker --region $REGION --format 'value(status.url)'
The shared secret to put in the Supabase Vault secret worker_secret:
  gcloud secrets versions access latest --secret worker-secret
EOF
