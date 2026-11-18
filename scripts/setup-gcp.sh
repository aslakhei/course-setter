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
set -euo pipefail

: "${PROJECT_ID:?set PROJECT_ID to the Google Cloud project id}"
REGION=europe-north1
GITHUB_REPO=aslakhei/course-setter # the only repository allowed to deploy
AR_REPO=course-setter

gcloud config set project "$PROJECT_ID" >/dev/null
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
WORKER_SA="worker@$PROJECT_ID.iam.gserviceaccount.com"
DEPLOY_SA="github-deploy@$PROJECT_ID.iam.gserviceaccount.com"
POOL="projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github"

exists() { "$@" >/dev/null 2>&1; }

echo "== APIs"
gcloud services enable run.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com \
  iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com

echo "== Artifact Registry (worker images; only recent ones are kept)"
exists gcloud artifacts repositories describe "$AR_REPO" --location "$REGION" ||
  gcloud artifacts repositories create "$AR_REPO" --repository-format docker --location "$REGION" \
    --description "Worker images"
policy=$(mktemp)
cat >"$policy" <<'JSON'
[
  { "name": "keep-recent", "action": { "type": "Keep" }, "mostRecentVersions": { "keepCount": 5 } },
  { "name": "delete-old", "action": { "type": "Delete" }, "condition": { "olderThan": "14d" } }
]
JSON
gcloud artifacts repositories set-cleanup-policies "$AR_REPO" --location "$REGION" --policy "$policy" --no-dry-run >/dev/null
rm -f "$policy"

echo "== Service accounts"
exists gcloud iam service-accounts describe "$WORKER_SA" ||
  gcloud iam service-accounts create worker --display-name "Course-setter worker (Cloud Run runtime)"
exists gcloud iam service-accounts describe "$DEPLOY_SA" ||
  gcloud iam service-accounts create github-deploy --display-name "GitHub Actions deploy"

# The deploy account may manage Cloud Run, push images and run the service as the worker account.
gcloud projects add-iam-policy-binding "$PROJECT_ID" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/run.admin --condition None >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$AR_REPO" --location "$REGION" \
  --member "serviceAccount:$DEPLOY_SA" --role roles/artifactregistry.writer >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$WORKER_SA" --member "serviceAccount:$DEPLOY_SA" \
  --role roles/iam.serviceAccountUser >/dev/null

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

cat <<EOF

Done. Set these GitHub repository variables (not secrets; they are not sensitive), e.g. with gh:

gh variable set GCP_PROJECT_ID --body "$PROJECT_ID"
gh variable set GCP_WORKLOAD_IDENTITY_PROVIDER --body "$POOL/providers/course-setter"
gh variable set GCP_DEPLOY_SERVICE_ACCOUNT --body "$DEPLOY_SA"
gh variable set GCP_WORKER_SERVICE_ACCOUNT --body "$WORKER_SA"

The next deploy from main then creates the Cloud Run service. Its URL:
  gcloud run services describe worker --region $REGION --format 'value(status.url)'
The shared secret to put in the Supabase Vault secret worker_secret:
  gcloud secrets versions access latest --secret worker-secret
EOF
