# Hair photo face-comparison setup

The photo checker uses the existing AI visual validation when CompreFace is not configured. Adding CompreFace enables a second, self-hosted comparison of the front, left-side, and right-side face-visible photos without per-request API charges.

## Start CompreFace

1. Install Docker Desktop.
2. Download or clone the official CompreFace project.
3. Start its Docker Compose stack.
4. Open the CompreFace interface, create a **Face Verification** service, and copy that service's API key.

Official project: https://github.com/exadel-inc/CompreFace

For local Supabase Edge Function development, use a CompreFace URL reachable from the Edge Function container, such as `http://host.docker.internal:8000` when supported by the local Docker setup.

For a deployed Supabase Edge Function, `localhost` will not work because it refers to Supabase's server. CompreFace must be hosted at a secure URL reachable from the internet.

## Supabase secrets

Run these commands from the project folder and replace the placeholder values:

```powershell
npx.cmd supabase secrets set COMPREFACE_URL="https://face.example.com"
npx.cmd supabase secrets set COMPREFACE_API_KEY="YOUR_FACE_VERIFICATION_SERVICE_KEY"
npx.cmd supabase secrets set COMPREFACE_SIMILARITY_THRESHOLD="0.80"
npx.cmd supabase secrets set COMPREFACE_DETECTION_THRESHOLD="0.80"
npx.cmd supabase secrets set COMPREFACE_TIMEOUT_MS="15000"
```

Deploy the updated validator:

```powershell
npx.cmd supabase functions deploy validate-hair-photo-set
```

## Processing behavior

- The Supabase Edge Function sends the two temporary base64 images to CompreFace's Face Verification REST endpoint.
- No face collection or named identity is created by this integration.
- Only the front, left-side, and right-side face-visible views are compared.
- The result checks consistency within the current photo set; it does not identify or name the user.
- Ambiguous or low-quality comparisons block analysis and request a retake instead of silently passing.
- If CompreFace is not configured, the existing per-view AI verification remains active as the fallback.
