# Sourced by deploy-azure.yml after Azure CLI login.
# Injects Impressum operator details into Azure Container Apps as an Azure secret
# without ever storing personal data in the Git repository or printing it in logs.
configure_impressum() {
  IMPRESSUM_DEPLOY_MANAGED=0
  IMPRESSUM_ENV_PAIRS=()
  local raw="${IMPRESSUM_DEPLOY_JSON:-}"

  if [[ -z "$raw" ]]; then
    return 0
  fi

  echo "::add-mask::$raw"

  # Mask individual JSON string values too, so no operator detail can leak into logs.
  local mask_line
  while IFS= read -r mask_line; do
    if [[ -n "$mask_line" ]]; then
      echo "::add-mask::$mask_line"
    fi
  done < <(IMPRESSUM_RAW="$raw" node -e '
    const raw = process.env.IMPRESSUM_RAW || "";
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) process.exit(1);
    if (typeof parsed.name !== "string" || !parsed.name.trim()) process.exit(1);
    if (typeof parsed.email !== "string" || !parsed.email.includes("@")) process.exit(1);
    for (const v of Object.values(parsed)) {
      if (typeof v === "string" && v.trim()) console.log(v.trim());
    }
  ' 2>/dev/null) || {
    echo '::error::AFFENTRADER_IMPRESSUM_JSON must be a valid JSON object containing at least "name" and "email".'
    return 1
  }

  local secret_ref="impressum-$(printf '%s' "$raw" | sha256sum | cut -c1-12)"
  if ! az containerapp secret set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --secrets "${secret_ref}=${raw}" --output none --only-show-errors >/dev/null 2>&1; then
    echo '::error::Azure rejected the Impressum secret update. Check the Container App deployment permissions.'
    return 1
  fi

  IMPRESSUM_ENV_PAIRS=("AFFENTRADER_IMPRESSUM_JSON=secretref:${secret_ref}")
  IMPRESSUM_DEPLOY_MANAGED=1
}
