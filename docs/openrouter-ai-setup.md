# OpenRouter setup for photo checks and wig previews

The API key belongs in Supabase Edge Function Secrets, not in the mobile app or an `EXPO_PUBLIC_*` variable.

## Configure the secrets

Run these commands from the project folder and replace the API-key placeholder:

```powershell
npx.cmd supabase secrets set OPENROUTER_API_KEY="sk-or-v1-YOUR_KEY_HERE"
npx.cmd supabase secrets set OPENROUTER_MODEL="openrouter/free"
npx.cmd supabase secrets set OPENROUTER_VISION_MODEL="google/gemini-3.1-flash-lite"
npx.cmd supabase secrets set OPENROUTER_HAIR_ANALYSIS_MODEL="google/gemini-3.1-flash-lite"
npx.cmd supabase secrets set OPENROUTER_HAIR_VALIDATION_MODEL="google/gemini-3.1-flash-lite"
npx.cmd supabase secrets set OPENROUTER_IMAGE_MODEL="openai/gpt-image-1"
npx.cmd supabase secrets set OPENROUTER_DATA_COLLECTION="deny"
npx.cmd supabase secrets set OPENROUTER_APP_NAME="Donivra"
```

Deploy the photo-set validator, capture accessory gate, and wig-preview function after setting the secrets:

```powershell
npx.cmd supabase functions deploy validate-hair-photo-set
npx.cmd supabase functions deploy validate-hair-capture-accessories
npx.cmd supabase functions deploy analyze-hair-submission
npx.cmd supabase functions deploy generate-wig-preview
```

## Provider behavior

- `google/gemini-3.1-flash-lite` is used for hair-photo validation and analysis because it supports image input and structured JSON output. It is billed through OpenRouter and requires available credits.
- `openrouter/free` remains available for non-hair workflows configured through `OPENROUTER_MODEL`. Free-model availability and limits can vary.
- `openai/gpt-image-1` is used through OpenRouter for the patient wig try-on image edit. Image generation is billed and requires OpenRouter credits.
- The patient photo and exact wig inventory image are sent as two reference images. The result is saved to the existing Supabase wig-preview storage bucket.
- OpenRouter is preferred when `OPENROUTER_API_KEY` is configured. Existing Google AI and direct OpenAI support remain available as fallbacks for photo validation.
- Every guided camera frame is checked before it is accepted into a photo slot. Visible eyeglasses and other face, head, or hair accessories block the frame and ask the user to retry.
- If the capture accessory check is unavailable or unclear, the app keeps the camera open and does not accept the frame.
- Wig-preview image generation requires OpenRouter and an `openai/*` value in `OPENROUTER_IMAGE_MODEL`; it will not silently fall back to a direct OpenAI request.
- The Edge Function reads Supabase Storage reference images with its server credentials and sends them to OpenRouter as image references, so private wig assets do not fail at the provider boundary.

For facial consistency, CompreFace remains optional. OpenRouter checks visible photo quality, accessories, view correctness, and obvious subject inconsistencies, but a general vision model is not a biometric identity service.

Review the OpenRouter account privacy settings before processing patient photos. Keep prompt logging disabled and enable the strictest provider data controls available for the selected image model.
