# Public multi-user security foundation

## Decision

Cozyland Studio is intended to be publicly accessible. Each signed-in user must only be able to read, update, delete, and stream their own episodes, audio, chat history, and custom voice profiles.

## Findings from the current server implementation

The current API uses shared filesystem storage in `.cozyland-data`. The episode and voice-profile routes do not establish an authenticated user identity before accessing records. Resource IDs are therefore not an authorization boundary. The local filesystem is also not durable storage for a horizontally scaled or restarted Cloud Run deployment.

These are source-review findings; they have not yet been validated with a live penetration test or deployment test.

## Target architecture

1. **Identity:** Firebase Authentication, initially using Google sign-in. The browser obtains a Firebase ID token and sends it as a Bearer token to every API request, including Server-Sent Events and audio requests.
2. **Verification:** Express verifies every ID token server-side with Firebase Admin SDK. The server derives the user ID exclusively from the verified token; it never trusts a user ID supplied in request JSON, query parameters, or resource IDs.
3. **Authorization:** Every episode, audio, chat, and custom voice-profile read/write is scoped to the verified UID. A record owned by another UID returns 404 (not found) to avoid disclosing its existence.
4. **Persistence:** Move user data and metadata to a durable database (Firestore is the proposed default) and audio blobs to private object storage. Storage access must be scoped by UID and must not expose public bucket URLs.
5. **Abuse controls:** Apply rate limits by authenticated UID as well as IP, enforce per-user generation quotas, validate uploads, and keep Gemini credentials exclusively on the server.
6. **Privacy:** Add account deletion/data export policy and clear user-facing disclosure for generated audio and uploaded voice samples. Voice cloning/calibration must retain explicit authorization consent.

## Required implementation sequence

- Add Firebase client initialization and sign-in UI, with Google sign-in as the initial provider.
- Add Firebase Admin token verification middleware and protect all non-health API routes.
- Add owner-aware database methods and migrate every episode/profile/audio access path.
- Update the frontend API helper and streaming/audio fetches to attach ID tokens.
- Add per-user quotas and operational logging without logging tokens, prompts, or private audio.
- Add automated tests proving unauthenticated requests are rejected and user A cannot access user B's resources.
- Configure Firebase project settings, authorized domains, Cloud Run service identity, Firestore, and private object storage.
- Run build, type-check, API authorization tests, and deployment smoke tests before enabling public access.

## Rollout safety

Do not merge or deploy the public multi-user implementation until Firebase project configuration and durable storage are available and the authorization tests pass. Keep the current production deployment unchanged during development. Never commit API keys, service-account JSON, ID tokens, or other secrets.
