#!/bin/bash
set -e

# Deployment config
PROJECT=jiragraph-9b9db
REGION=us-central1
SERVICE=jira-visualizer

# Read from .env
ADMIN_EMAILS=$(grep '^ADMIN_EMAILS=' .env | cut -d'=' -f2 | tr -d "\'\"")
SERVICE_URL=$(grep '^SERVICE_URL=' .env | cut -d'=' -f2 | tr -d "\'\"")

gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --project "$PROJECT" \
  --allow-unauthenticated \
  --max-instances 1 \
  --set-env-vars "^|^NODE_ENV=production|ADMIN_EMAILS=${ADMIN_EMAILS}|CORS_ORIGIN=${SERVICE_URL}" \
  --set-secrets SESSION_SECRET=SESSION_SECRET:latest,JIRA_CLIENT_ID=JIRA_CLIENT_ID:latest,JIRA_CLIENT_SECRET=JIRA_CLIENT_SECRET:latest,JIRA_REDIRECT_URI=JIRA_REDIRECT_URI:latest

echo "Deployed: ${SERVICE_URL}"
