# Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Global Default Deny**: Any path not explicitly matched is denied (`allow read, write: if false;`).
2. **Ownership Isolation**: Every document in `/records/{recordId}` belongs strictly to a single authenticated user (`ownerId == request.auth.uid`). Users cannot read, list, update, or delete records belonging to another user.
3. **Verified Identity for Writes**: All write operations (`create`, `update`, `delete`) require `request.auth != null && request.auth.token.email_verified == true`.
4. **Strict Schema & Key Whitelisting**: Every `create` and `update` must pass `isValidRecordItem(incoming())`, enforcing exact key sets (`hasAll` and `hasOnly`), string lengths, numeric ranges, enum memberships, and regex patterns (`^[a-zA-Z0-9_\-]+$`).
5. **Path ID Hardening**: Document ID `{recordId}` on single-document operations (`get`, `create`, `update`, `delete`) must satisfy `isValidId(recordId)` (`1..128` chars matching `^[a-zA-Z0-9_\-]+$`).
6. **Temporal & Ownership Immutability**: On `create`, `createdAt == request.time` and `updatedAt == request.time`. On `update`, `ownerId` and `createdAt` must remain identical to `existing()`, while `updatedAt == request.time`.
7. **Terminal State Locking**: Once a record reaches `status == 'Archivado'`, no subsequent `update` operations are permitted (`existing().status != 'Archivado'`).

## 2. The "Dirty Dozen" Payloads

1. **Identity Spoofing on Create**: Creating a record where `ownerId` is set to `"victim_user_uid"` instead of `request.auth.uid`.
2. **Unverified Email Write**: Attempting to create a record when `request.auth.token.email_verified == false`.
3. **Shadow / Ghost Field Injection**: Sending all valid fields plus `"isAdmin": true` or `"extraField": "hack"`.
4. **Oversized Title DoS**: Sending `title` with 5,000 characters (exceeding `maxLength: 120`).
5. **Invalid Code Format Injection**: Sending `code: "REG<script>alert(1)</script>"` (violating `^[a-zA-Z0-9_\-]+$`).
6. **Invalid Enum Value**: Sending `category: "HackCategory"` or `status: "Deleted"`.
7. **Client Forged Timestamp on Create**: Sending `createdAt` as a past or future timestamp not equal to `request.time`.
8. **Ownership Hijack on Update**: Updating `ownerId` to transfer ownership of an existing record.
9. **Historical Timestamp Tampering**: Modifying `createdAt` during an `update` operation.
10. **Terminal State Bypass**: Attempting to update `amount` or `status` on a record whose `existing().status == 'Archivado'`.
11. **Cross-Tenant List Scraping**: Querying `/records` without filtering by `ownerId == request.auth.uid`.
12. **Poisoned Document ID**: Creating a document with an invalid ID containing spaces or special characters or exceeding 128 chars.
