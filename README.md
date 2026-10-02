# Living Current

A mobile-first household finance tracker for recording income, expenses, upcoming bills, and genuinely available funds without linking a bank account.

## Current features

- Current balance split between checking and savings
- Available Balance after 31-day Bill Planning and the safety buffer
- Expense, income, and checking/savings transfer entry
- Current-month activity plus a monthly archive
- Pending transaction tracking and bank-import reconciliation
- Searchable household activity with per-device household identity
- Bank-statement, CSV, and JSON import/export
- Local preview mode when Firebase is not configured
- Firebase email/password Authentication and Cloud Firestore synchronization
- Installable PWA shell and offline asset caching
- GitHub Pages deployment workflow

## Local development

```bash
npm install
npm run dev
```

The app works immediately with an empty local household. Copy `.env.example` to `.env.local` and add your Firebase Web App values to enable cloud synchronization.

## Firebase setup

1. Create or select a Firebase project.
2. Add a Web App and copy its configuration values into `.env.local`.
3. Enable **Email/Password** under Authentication → Sign-in method.
4. Create a Cloud Firestore database.
5. Deploy `firestore.rules` with the Firebase CLI.
6. Create the shared household login in Living Current.
7. Sign in with the same household email and password on the second device.
8. In Settings, select which household member normally uses each device. This preference stays on that device.

## Balance model

The Settings page stores an opening checking and savings balance for the first tracked month. Living Current derives the current account balances from those opening values and all later expenses, income, refunds, and transfers. Archived months before the opening month remain available for review without changing the current balance.

Bill Planning is the total of unpaid bills due within 31 days. It does not move money between accounts. Available Balance is Current Balance minus Bill Planning and the safety buffer.

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
date,description,category,amount,type,account,transferTo,enteredBy
2026-10-01,Publix,Groceries,-184.47,expense,checking,,Pat
2026-10-01,Move rent funds,Transfer,500.00,transfer,checking,savings,Pat
```

JSON:

```json
{
  "schemaVersion": 3,
  "transactions": [
    {
      "date": "2026-10-01",
      "description": "Publix",
      "category": "Groceries",
      "amount": -184.47,
      "type": "expense",
      "account": "checking",
      "enteredBy": "Pat"
    }
  ]
}
```
