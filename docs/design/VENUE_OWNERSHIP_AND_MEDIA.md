# Venue ownership and ground photos — technical design

Status: **Proposal, not implemented.** Awaiting approval (V5.1). Date: 2026-11-08.

## 1. Goal and constraints

Let the real operators of a ground publish photos of it. Every photo shown on a ground card must have been supplied by someone PlayR has verified as entitled to represent that ground.

Hard rules:
- **Knowing a ground's name or address never grants anything.** A claim is only approved on evidence checked by a PlayR reviewer, or on an automated proof tied to the venue's own public contact channel.
- Players, captains and anonymous users cannot upload ground photos. A captain's match photo stays attached to the match (V5) and never becomes the venue's photo.
- Nothing is public until it has passed moderation.
- Every ownership and photo decision is audited.

## 2. Current state

- `venues` is a seeded, read-only collection: name, address, area, city and GeoJSON location. It has no owner and no media. The API is `GET /venues` only.
- Users have `roles: list[str]`. Admin moderation exists under `/admin`.
- Reports (`/reports`) target users only.
- Uploads (V5): validated, re-encoded and EXIF-stripped. Stored locally, with a Cloudinary adapter stub. Media fields accept only PlayR uploads (`is_own_media`).

## 3. Data model

```text
venues                         (existing; new fields)
  status: "listed" | "claimed" | "suspended"
  verified_at, verified_by
  photo_count, cover_photo_id                        → venue_photos

venue_admins                   (new; one row per person per venue)
  venue_id, user_id
  role: "owner" | "manager"
  status: "active" | "removed"
  granted_by, granted_at, removed_by, removed_at
  unique (venue_id, user_id) where status = active
  invariant: at most 1 active owner per venue

venue_claims                   (new)
  venue_id, claimant_user_id
  status: "pending" | "needs_info" | "approved" | "rejected" | "withdrawn" | "expired"
  method: "documents" | "phone_callback" | "email_domain"
  evidence: [{ kind, upload_id }]                   private bucket, never public
  business_name, contact_phone, contact_email
  reviewer_id, decision_reason, decided_at
  expires_at                                        30 days after the last update
  index: one pending claim per (venue_id, claimant)

venue_photos                   (new)
  venue_id, uploader_id
  storage_key                                       private-original key
  variants: { thumb, card, full }                   public CDN keys, set after approval
  status: "pending" | "approved" | "rejected" | "removed"
  caption (≤ 120 chars, optional), width, height, sha256
  moderated_by, moderated_at, reject_reason
  report_count

venue_transfers                (new)
  venue_id, from_user_id, to_user_id
  status: "offered" | "accepted" | "declined" | "cancelled" | "expired"
  expires_at                                        7 days
```

## 4. Ownership and verification

### 4.1 Claiming an existing venue
1. The user opens a ground and taps **"I run this ground"**. They must be signed in with a verified mobile number, and the account must be at least 7 days old.
2. The user chooses a verification method:
   - **Phone callback (preferred):**
     - A PlayR reviewer calls the venue's publicly listed number. That number comes from an independent source such as Google Business, the venue's own website or a signboard photo, and never from the claimant.
     - The person who answers confirms the claimant's name and reads back a 6-digit code shown in the claimant's app.
   - **Documents:** a business registration, lease, GST certificate or an official letter that names the venue. These are uploaded to a private evidence bucket, viewable only by reviewers, and deleted 90 days after the decision.
   - **Email domain:** a one-time link sent to an address on the venue's own website domain. Free-mail domains are never accepted.
3. The claim enters the admin queue at `/admin/venue-claims`. The reviewer sees the evidence, the claimant's account history and any competing claims for the same venue.
4. On approval:
   - A `venue_admins` row is created with role owner, and the venue status becomes `claimed`.
   - The audit log records the decision and the reason.
   - The claimant is notified.
   - Other pending claims for the venue go to `needs_info`, with a note that the venue already has a verified owner.
5. Rejected claimants may re-apply after 14 days. Three rejections lock further claims for that venue, and an admin can unlock it.

Anti-abuse:
- At most 3 open claims per user.
- Claims are rate-limited per user and per IP.
- A venue that already has an owner can only change hands through a transfer (4.3) or a dispute (4.5).

### 4.2 Multiple administrators
- **Owner:**
  - Manages photos.
  - Invites and removes managers.
  - Starts a transfer.
  - Edits non-identity details (description, facilities) once those features exist.
- **Manager:** manages photos only.
- The owner invites a manager by phone number. The invitee must accept in the app, and an unaccepted invite expires after 7 days.
- A venue can have at most 10 managers.
- Name, address and location changes always go through admin review. Owners cannot move or rename a venue themselves.

### 4.3 Transfer of ownership
1. The owner offers ownership to an existing manager or to a phone number.
2. The recipient accepts within 7 days and confirms with an OTP.
3. The previous owner becomes a manager, or leaves if they choose.
4. If the owner is unreachable (lost account, business sold), the new operator files a fresh claim. The reviewer can approve it as a replacement, which demotes the old owner and records the decision in the audit log.

### 4.4 Removal and suspension
- An admin can suspend a venue. This hides its photos and freezes its admins.
- An admin can also remove any venue admin.
- Removal never deletes approved photos automatically. The new owner or an admin decides what to keep.

### 4.5 Disputes
When someone reports that a venue's owner is wrong, the report opens an admin case. The case puts both parties' evidence side by side, and the reviewer decides. Photo changes are frozen while the case is open.

## 5. Photo upload authorisation

Endpoint: `POST /venues/{id}/photos` (multipart) or a signed direct upload (section 7).

Authorisation runs on the server for every request:
1. The caller has an active `venue_admins` row for this venue, with role owner or manager.
2. The venue status is `claimed`, not `suspended`.
3. Quotas: 20 approved photos per venue, 10 uploads per day per venue, and 5 MB per file.
4. The file passes the existing V5 pipeline:
   - magic-byte validation
   - Pillow decode
   - re-encode, with EXIF and GPS stripped
   - decompression-bomb guard
   - maximum edge of 2400 px
5. A perceptual hash is checked against rejected and removed photos. This stops a removed image from being uploaded again.

Other photo actions:
- Upload returns a photo with status `pending`. Owners and managers see their pending photos with a "Under review" label. Nobody else sees them.
- `DELETE /venues/{id}/photos/{photo_id}`: owner or manager. This is a soft delete: status becomes `removed` and the CDN variants are purged.
- `PUT /venues/{id}/cover`: owner or manager, and only for an approved photo.

Public read: `GET /venues` and `GET /venues/{id}` return approved photos only, as CDN URLs.

The mobile `GroundCoverImage` already renders `uri` and falls back to "No photos from this venue yet", so it needs no UI change beyond passing the URL.

## 6. Moderation and reporting

**Pre-moderation.** Every photo is checked before it becomes public.
- **Automated checks:**
  - nudity, violence and text-heavy spam, using a vision moderation API
  - a face-count heuristic: images dominated by close-up faces are flagged, since photos should show the ground, not identifiable people
  - duplicate detection
- **Human queue at `/admin/venue-photos`:** approve or reject with a reason, plus bulk actions. Target turnaround is 24 hours.
- **Auto-approval:** after an owner has had 5 photos approved with no rejections, their uploads with clean automated scores are approved automatically. They still enter a sampling queue for spot checks.

**Reporting:**
- Extend `/reports` with `target_type: "venue_photo" | "venue_claim"`.
- Categories: not this venue, inappropriate, identifiable people or privacy, copyright, other.
- Three distinct reports hide the photo pending review.
- Any report in the copyright or privacy category hides it immediately.

**Takedown:**
- Removing a photo purges its CDN variants within minutes.
- The original is kept in the private bucket for 30 days, for appeals and legal hold, then deleted.

**Notifications:** owners are told when a photo is approved, rejected or removed, with the reason.

**Audit:** every claim decision, admin change, transfer and photo moderation action is written to `audit_logs`.

## 7. Storage and CDN delivery

The current local disk storage is development only. Proposed production setup:

| Concern | Proposal |
|---|---|
| Object store | S3-compatible storage, such as Cloudflare R2 (no egress fees) or AWS S3 in ap-south-1, behind the existing `StorageProvider` interface. |
| Buckets | `playr-private` holds originals, pending photos and claim evidence. It is never public, and short-lived signed GETs are for reviewers only. `playr-public` holds approved variants only. |
| Upload path | Client → API (auth, quota, validation) → re-encode → private bucket. Signed direct-to-bucket uploads are deferred, because the API must re-encode every image anyway. |
| Variants | Generated on approval: `thumb` (320 px), `card` (800 px) and `full` (1600 px), as WebP with a JPEG fallback. Keys are content-hashed and immutable. |
| CDN | Cloudflare or CloudFront in front of `playr-public`. Cache headers: `Cache-Control: public, max-age=31536000, immutable`. Removal purges the keys. |
| URLs in the API | `https://media.playr.app/v/<hash>.webp`. Add this host to the `is_own_media` allow rule; it currently accepts relative `/uploads` paths. |
| Mobile | `expo-image` with `cachePolicy="memory-disk"`, which is already in place. Pick the variant by rendered size. |
| Security | No public listing. Server-side encryption. The CORS allowlist limits the media host to GET. Signed URLs for evidence expire after 5 minutes. |
| Cost guard | Quotas from section 5, and lifecycle rules that delete pending or rejected originals after 30 days. |

## 8. API summary (proposed)

```text
POST   /venues/{id}/claims                  start a claim (rate-limited)
GET    /users/me/venue-claims               my claims
POST   /venue-claims/{id}/withdraw
GET    /admin/venue-claims?status=          reviewer queue
POST   /admin/venue-claims/{id}/decision    approve | reject | needs_info
GET    /venues/{id}/admins                  owner or manager
POST   /venues/{id}/admins                  owner invites a manager
DELETE /venues/{id}/admins/{user_id}        owner, or admin
POST   /venues/{id}/transfer                owner offers ownership
POST   /venue-transfers/{id}/accept         recipient, with OTP
POST   /venues/{id}/photos                  owner or manager upload → pending
DELETE /venues/{id}/photos/{photo_id}
PUT    /venues/{id}/cover
GET    /admin/venue-photos?status=pending
POST   /admin/venue-photos/{id}/decision
```

## 9. Rollout

1. **Phase A:** data model, claims with document and phone-callback verification, and the admin claim queue. No photos yet.
2. **Phase B:**
   - Photo uploads with pre-moderation.
   - The R2 or S3 storage provider and the CDN.
   - Approved photos shown on ground cards.
3. **Phase C:** managers, transfers, the reporting extensions, and auto-approval for trusted owners.
4. **Phase D, optional:** email-domain verification and automated moderation scoring.

Each phase ships with tests covering:
- a non-admin upload attempt
- a removed manager
- a suspended venue
- a claim on an already-claimed venue
- a pending photo that must stay invisible to the public
- cross-venue access attempts (IDOR)

## 10. Open questions for approval

1. Reviewer capacity: who handles the claim and photo queues, and what turnaround is acceptable?
2. Should PlayR allow venues that aren't in the seed list, such as "Add a ground"? That needs its own verification path.
3. Which provider: Cloudflare R2 with Cloudflare CDN, or AWS S3 with CloudFront?
4. Which vision moderation provider, and how will its processing of Indian users' images be disclosed in the privacy policy?
5. How long should claim evidence be kept? Proposed: 90 days after the decision.
