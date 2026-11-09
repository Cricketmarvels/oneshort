# Personal data breach response runbook

Applies to any unauthorised access to, or loss, disclosure or corruption of, PlayR users' personal data (DPDP Act s.8(6), DPDP Rules 2025 Rule 7).

**Clock:** tell affected users without delay, and send the detailed report to the Data Protection Board **within 72 hours of becoming aware**.

## Roles

| Role | Who | Responsibility |
|---|---|---|
| Incident lead | On-call engineer → Grievance Officer | Runs the response and keeps the timeline |
| Technical lead | Backend engineer | Contain, investigate, preserve evidence |
| Communications | Founder / Grievance Officer | User and Board notices |

## Steps

### 0–1 h: confirm and contain
1. Open an incident record: time detected, who found it, first facts.
2. Contain the breach: revoke leaked keys or tokens, rotate `JWT_SECRET` (which logs everyone out), block the attacker's IPs, disable the affected endpoint or feature, and suspend compromised accounts.
3. Preserve evidence: export the relevant `audit_logs`, API logs, Sentry events and database access logs, and snapshot the database before changing data.

### 1–24 h: assess
4. Establish what data was involved, whose, how many people, the time window, and whether it was encrypted or hashed.
5. Decide the likely harm: identity misuse, harassment (phone numbers, locations), financial (fee records), or reputation.
6. Send the **initial intimation to the Board** describing the breach: its nature, extent, timing, location and likely impact.

### Without delay: tell affected users
7. Notify each affected person in the app and by email or SMS. Use plain language and include:
   - what happened and when;
   - what data was affected;
   - the likely consequences;
   - what PlayR has done;
   - what they should do (change password, watch for scam calls, never share an OTP);
   - a contact (the Grievance Officer).

### Within 72 h: detailed report to the Board
8. Send the updated, detailed report, covering:
   - facts and circumstances;
   - cause;
   - mitigation;
   - the findings about the person responsible, if known;
   - remedial measures taken to prevent a repeat;
   - the notices sent to users.

### After the incident
9. Write a blameless post-incident review within 14 days, with the fix and a test for it, plus a monitoring improvement.
10. Keep the incident record, notices and reports for at least 3 years.

## Contacts to keep current
- Data Protection Board of India: submission channel as notified by MeitY.
- CERT-In: cyber incidents must be reported to CERT-In within 6 hours under its 2022 directions (incident@cert-in.org.in).
- Hosting, database (MongoDB Atlas) and SMS/WhatsApp provider security contacts.
