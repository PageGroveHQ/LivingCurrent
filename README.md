# Living Current

A mobile-first household finance tracker for recording income, expenses, upcoming bills, and genuinely available funds without linking a bank account.

## Included in the first build

- Shared financial overview and safe-to-spend calculation
- Fast income and expense entry
- Upcoming bill tracking and reserved-funds calculation
- Searchable household activity
- CSV and JSON import/export
- Local preview mode when Firebase is not configured
- Firebase Anonymous Authentication and Cloud Firestore synchronization
- Installable PWA shell and offline asset caching
- GitHub Pages deployment workflow

## Local development

```bash
npm install
npm run dev
```

The app works immediately with local sample data. Copy `.env.example` to `.env.local` and add your Firebase Web App values to enable cloud synchronization.

## Firebase setup

1. Create or select a Firebase project.
2. Add a Web App and copy its configuration values into `.env.local`.
3. Enable **Anonymous** under Authentication → Sign-in method.
4. Create a Cloud Firestore database.
5. Deploy `firestore.rules` with the Firebase CLI.
6. Open Living Current on the first device. It creates the household document and enrolls that anonymous device.
7. Open Settings on the second device and copy its Device ID.
8. In Firestore, add that ID to the household document's `memberUids` array.

This bootstrap is intentionally manual in the first build. A one-time QR pairing flow can replace steps 7–8 without adding usernames or passwords.

## GitHub Pages

Add these repository secrets before enabling the included Pages workflow:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_STORAGE_BUCKET`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_HOUSEHOLD_ID`

Then select **GitHub Actions** as the Pages source. The workflow publishes only this repository's build and does not reference Learning Arcade, Meadow Pals, or any other project.

## Import formats

CSV header:

```csv
date,description,category,amount,enteredBy
2026-10-01,Publix,Groceries,-184.47,Pat
```

JSON:

```json
{
  "schemaVersion": 1,
  "transactions": [
    {
      "date": "2026-10-01",
      "description": "Publix",
      "category": "Groceries",
      "amount": -184.47,
      "enteredBy": "Pat"
    }
  ]
}
```
