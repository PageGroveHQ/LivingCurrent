# Free background bill reminders

The website stays on GitHub Pages and household data stays in Firebase. GitHub Actions reads only the configured Living Current household and sends standard Web Push. No Cloud Functions, Cloud Scheduler, or Blaze upgrade is used.

## One-time setup

1. Run `npm ci --prefix functions` then `npm run keys --prefix functions`. Keys are generated into the Git-ignored `functions/.push-setup/` folder. Keep the pair; rotating it requires disabling/re-enabling every device. The public key may be shared; the private key must never go into source, chat, logs, or screenshots.
2. In **LivingCurrent → Settings → Secrets and variables → Actions**, add:
   - `VITE_WEB_PUSH_PUBLIC_KEY`: contents of `public-key.txt` (also used by the Pages build).
   - `LIVING_CURRENT_WEB_PUSH_PRIVATE_KEY`: contents of `private-key.txt`.
   - `LIVING_CURRENT_FIREBASE_SERVICE_ACCOUNT_JSON`: JSON credentials for a dedicated service account in the Living Current Firebase project with Firestore data access. Prefer a custom role with only the required entity get/list/create/update/delete permissions. Do not use Owner/Editor or credentials for Learning Arcade/Meadow Pals. Service-account access bypasses Firestore rules and is project-scoped, so protect it carefully; the script's household restriction is not an IAM boundary. If the project contains unrelated private data, use a separate project or a more restricted authentication design before supplying this credential.
   - Existing `VITE_FIREBASE_PROJECT_ID` and `VITE_FIREBASE_HOUSEHOLD_ID` must match this household. If household ID is omitted, the app and workflow use `living-current-home`.
3. Publish **only** this repository's `firestore.rules` to the matching Firebase project (Firebase console Rules editor, or `firebase deploy --only firestore:rules --project YOUR_LIVING_CURRENT_PROJECT_ID`). The new rules allow household members to register/unregister push devices. Delivery history stays server-only. No Firebase Hosting deployment is needed.
4. Run the **Deploy Living Current to GitHub Pages** workflow again so the public key enters the build. Update the app from Settings.
5. On each device, sign in, open the bell menu, and select **Enable on this device**. On iPhone/iPad, use iOS/iPadOS 16.4+ and open the app from its Home Screen icon, then allow notifications. Desktop/Android browser support varies; the app checks capability.
6. Close the app. In GitHub Actions, run **Send Living Current bill reminders**, select **Test**, and run it. Verify that a background test appears on both devices. A local display test inside the app is not an end-to-end delivery test. Background tests are deduplicated to once per device per Eastern day.

## Reminder behavior

- Each bill has one lead time: 1, 3, 7 days before, or Off. Existing bills default to 3.
- Morning checks run at 13:00 and 14:00 UTC, targeting 9:00 AM Eastern (EST/EDT). The script skips runs before 9 AM Eastern and deduplicates later runs. This covers daylight saving changes and supplies a second attempt in summer. GitHub scheduling can delay delivery.
- A reminder goes out once per bill ID/due date/lead-time/device. Late-added bills or devices catch up within the selected window through the due date, not after it. Changing the reminder lead time can result in another reminder.
- Paid/deleted bills are rechecked immediately before sending. A payment made after a message has already been sent cannot recall that notification.
- Tap a notification to open Bills. The message intentionally omits bill names and dollar amounts.
- Delivery depends on the push service, connectivity, OS permissions and Focus settings. GitHub schedules may be delayed/dropped; this is not an exact-time alarm or guaranteed delivery. In inactive public repositories GitHub may disable schedules after 60 days; re-enable the workflow if that happens.
- Standard GitHub-hosted runners are free for public repositories; private repositories have plan-dependent quotas. Firebase remains subject to its Spark limits. Do not enable paid runner types or upgrade billing for this workflow.
- Expired push subscriptions (404/410) are removed by the sender. Re-enable on a device if needed. Disabling one device does not affect the other.
- The workflow never logs credentials, bill names/amounts, or push endpoints. It has read-only repository permissions, no pull-request trigger, and serialized runs. It only reads/writes notification metadata; it does not modify financial transactions or bill payment state.

## Security and maintenance

Credentials are available to code in this repository's workflow. Limit write access to the repository, protect the default branch, and review dependency updates. Do not put service-account JSON into repository files. Revoke the service-account key and rotate the private push key if compromised; then re-register devices. Prefer GitHub OIDC federation instead of a long-lived service-account key when you have that configured.

The bell menu also shows notification health: registered devices, latest scheduler check, last successful run, and push-service acceptance/failure counts. Publish the latest rules again after installing this update to permit household-only health/device-list reads. Device registration is not proof of delivery; an accepted push is not confirmation that a phone displayed it. Checks older than 36 hours are flagged. Credentials/authentication failures may prevent health updates; review GitHub Actions for those cases.

Tests: `npm test` and `npm test --prefix functions`. No live push can be verified before the secrets, rules, and device registration are configured.
