# Deployment — Google Cloud Run

This guide deploys `linkedin-share-resolver` to Google Cloud Run with secrets in
Secret Manager. **Nothing here is run for you automatically** — review each
command. Steps that create billable resources are clearly marked.

> Recommended Cloud Run configuration
>
> | Setting        | Value                      |
> | -------------- | -------------------------- |
> | Service name   | `linkedin-share-resolver`  |
> | Region         | e.g. `us-central1`         |
> | Memory         | `2Gi`                      |
> | CPU            | `1`                        |
> | Concurrency    | `1`                        |
> | Timeout        | `90s`                      |
> | Min instances  | `0`                        |
> | Max instances  | `2`                        |

---

## 0. Prerequisites you must complete

These require **your** Google account / project and may involve billing. Do them
yourself (or tell me the project ID and I can show exact commands):

1. **Install the gcloud CLI** — <https://cloud.google.com/sdk/docs/install>
   (Not currently installed on this machine.)
2. **Authenticate**

   ```bash
   gcloud auth login
   ```
3. **Select / create a project**

   ```bash
   gcloud projects list
   gcloud config set project YOUR_PROJECT_ID
   ```
4. **Ensure billing is enabled** on that project (Cloud Run + Artifact Registry
   require it): <https://console.cloud.google.com/billing>
5. **Enable required APIs**

   ```bash
   gcloud services enable \
     run.googleapis.com \
     cloudbuild.googleapis.com \
     artifactregistry.googleapis.com \
     secretmanager.googleapis.com
   ```
6. **Permissions** — your account needs at minimum: `roles/run.admin`,
   `roles/cloudbuild.builds.editor`, `roles/secretmanager.admin` (to create
   secrets), and `roles/iam.serviceAccountUser`. A project Owner has all of these.

Set a couple of shell variables used below:

```bash
export PROJECT_ID="YOUR_PROJECT_ID"
export REGION="us-central1"
export SERVICE="linkedin-share-resolver"
```

---

## 1. Create secrets in Secret Manager  *(billable: negligible)*

### RESOLVER_API_KEY

Generate a strong key and store it:

```bash
# generate (or pick your own) and store as the first secret version
printf '%s' "$(openssl rand -hex 32)" | \
  gcloud secrets create RESOLVER_API_KEY --data-file=- --replication-policy=automatic

# View the value later (keep it safe — Clay needs it):
gcloud secrets versions access latest --secret=RESOLVER_API_KEY
```

### LINKEDIN_COOKIES (recommended — captured automatically, no copy/paste)

The authenticated fallback needs a logged-in LinkedIn session. **You do not copy
or paste any cookie values.** Run the capture helper, which opens a real browser
window — just log into LinkedIn normally in that window and it writes a
`cookies.json` in the correct Playwright format automatically (values are never
printed to the terminal):

```bash
npm run capture:cookies          # opens a browser; log in; writes ./cookies.json
```

Then store it in Secret Manager and delete the local file:

```bash
gcloud secrets create LINKEDIN_COOKIES --data-file=cookies.json --replication-policy=automatic
rm cookies.json   # do not leave cookies on disk
```

> The file is a JSON array of `{ name, value, domain, path, httpOnly, secure, sameSite, expires }`
> objects (e.g. `li_at`, `JSESSIONID`) — exactly what the service's
> `loadCookies()` accepts. It is git-ignored so it can never be committed.

> Cookies expire. When the service starts returning `SESSION_EXPIRED`, add a new
> secret version: `gcloud secrets versions add LINKEDIN_COOKIES --data-file=cookies.json`

### Grant the Cloud Run runtime service account access to the secrets

```bash
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

for SECRET in RESOLVER_API_KEY LINKEDIN_COOKIES; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${RUNTIME_SA}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 2. Deploy  *(billable: Cloud Build + Cloud Run + Artifact Registry)*

This uses Cloud Build to build the Docker image from source (no local Docker
required) and deploys it. **This is the step that creates paid resources — only
run it when you're ready.**

This command uses the chosen access model: **public invocation + `X-API-Key`**
(`--allow-unauthenticated`). The service is reachable over the internet, and the
app's `X-API-Key` header is the access control — which is exactly what Clay
sends. No Google identity token is required on Clay's side.

```bash
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --platform managed \
  --memory 2Gi \
  --cpu 1 \
  --concurrency 1 \
  --timeout 90 \
  --min-instances 0 \
  --max-instances 2 \
  --allow-unauthenticated \
  --set-env-vars "PAGE_TIMEOUT_MS=45000,ENABLE_DEBUG_ARTIFACTS=false,LOG_LEVEL=info" \
  --set-secrets "RESOLVER_API_KEY=RESOLVER_API_KEY:latest,LINKEDIN_COOKIES=LINKEDIN_COOKIES:latest"
```

Notes:
- Omit the `LINKEDIN_COOKIES=...` part of `--set-secrets` if you have not created
  that secret yet (you can add it and redeploy later).
- Because invocation is public, **treat `RESOLVER_API_KEY` as the only thing
  standing between the internet and your service** — use a strong random key
  (the `openssl rand -hex 32` above) and rotate it if leaked.
- If you later need IAM-level auth instead, redeploy with
  `--no-allow-unauthenticated` and have Clay send a Google-signed
  `Authorization: Bearer` token.

Get the URL:

```bash
SERVICE_URL=$(gcloud run services describe "$SERVICE" --region "$REGION" --format='value(status.url)')
echo "$SERVICE_URL"
```

---

## 3. Post-deploy verification

```bash
# Health (public)
curl "$SERVICE_URL/health"
# -> {"status":"ok"}

# Resolve (needs the API key)
API_KEY=$(gcloud secrets versions access latest --secret=RESOLVER_API_KEY)

curl -X POST "$SERVICE_URL/resolve" \
  -H "Content-Type: application/json" \
  -H "X-API-Key: $API_KEY" \
  -d '{"share_url":"https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay"}'
```

A `resolved` response returns `activity_url` + `activity_id`. If you get
`LOGIN_REQUIRED`, configure `LINKEDIN_COOKIES` (step 1) and redeploy.

---

## 4. Clay HTTP API enrichment configuration

In Clay, add an **HTTP API** enrichment column that runs only when the post URL
contains `-share-` or `urn:li:share:`.

- **Method:** `POST`
- **URL:** `https://<your-cloud-run-service-url>/resolve`
- **Headers:**

  ```
  Content-Type: application/json
  X-API-Key: <your RESOLVER_API_KEY>
  ```
- **Body:**

  ```json
  { "share_url": "{{Original Post URL}}" }
  ```

Map the JSON response fields to columns:

| Response field | Clay column        |
| -------------- | ------------------ |
| `activity_url` | Activity URL       |
| `activity_id`  | Activity ID        |
| `status`       | Resolution Status  |
| `error_code`   | Error Code         |

Then feed the **Activity URL** column into Clay's LinkedIn post audience /
reactions extraction step.

---

## 5. Local Docker verification (optional, requires Docker)

Docker is **not installed** on this machine. If you install Docker Desktop, you
can verify the container locally before deploying:

```bash
docker build -t linkedin-share-resolver:local .

docker run --rm -p 8080:8080 \
  -e RESOLVER_API_KEY=local-test-key \
  -e LOG_LEVEL=info \
  linkedin-share-resolver:local

# in another shell:
curl http://localhost:8080/health
curl -X POST http://localhost:8080/resolve \
  -H "Content-Type: application/json" -H "X-API-Key: local-test-key" \
  -d '{"share_url":"https://www.linkedin.com/posts/were-headed-to-london-were-excited-share-7472364428009680896-yWay"}'
```

---

## Updating the service

```bash
# redeploy after code changes
gcloud run deploy "$SERVICE" --source . --region "$REGION"

# rotate the API key
printf '%s' "$(openssl rand -hex 32)" | gcloud secrets versions add RESOLVER_API_KEY --data-file=-
gcloud run services update "$SERVICE" --region "$REGION" \
  --update-secrets "RESOLVER_API_KEY=RESOLVER_API_KEY:latest"
```

## Teardown (stop all billing)

```bash
gcloud run services delete "$SERVICE" --region "$REGION"
gcloud secrets delete RESOLVER_API_KEY
gcloud secrets delete LINKEDIN_COOKIES
```
