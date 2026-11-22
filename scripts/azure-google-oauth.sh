# Sourced by deploy-azure.yml after Azure CLI login.
configure_google_oauth() {
  GOOGLE_DEPLOY_MANAGED=0
  GOOGLE_ENV_ARGS=()
  local client_id="${GOOGLE_DEPLOY_CLIENT_ID:-}" client_secret="${GOOGLE_DEPLOY_CLIENT_SECRET:-}"

  if [[ -z "$client_id" && -z "$client_secret" ]]; then
    return 0
  fi
  if [[ -z "$client_id" || -z "$client_secret" ]]; then
    echo '::warning::Google OAuth needs both repository credentials. Existing Azure settings were retained.'
    return 0
  fi
  if [[ ! "$client_id" =~ ^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$ || ! "$client_secret" =~ ^[A-Za-z0-9_-]{12,256}$ ]]; then
    echo '::error::Google OAuth credentials do not match the expected Web client format.'
    return 1
  fi

  # Use a new Azure secret reference when the pair rotates. An older revision
  # can still use the reference under which it was verified.
  local secret_ref="oidc-$(printf '%s\0%s' "$client_id" "$client_secret" | sha256sum | cut -c1-12)"
  if ! az containerapp secret set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --secrets "${secret_ref}=${client_secret}" --output none --only-show-errors >/dev/null 2>&1; then
    echo '::error::Azure rejected the Google OAuth secret update. Check the Container App deployment permissions.'
    return 1
  fi

  GOOGLE_ENV_ARGS=(--set-env-vars
    "AFFENTRADER_GOOGLE_CLIENT_ID=${client_id}"
    "AFFENTRADER_GOOGLE_CLIENT_SECRET=secretref:${secret_ref}"
    "AFFENTRADER_GOOGLE_REDIRECT_URI=${LIVE_BASE}/api/account/google/callback")
  GOOGLE_DEPLOY_MANAGED=1
}
