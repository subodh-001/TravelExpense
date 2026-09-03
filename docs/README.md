# 🚀 Monthly Travel Expense Tracker

Complete full-stack **Mobile App + Web Dashboard + Backend REST API** solution for tracking monthly travel expenses, preserving Excel matrix formatting, storing receipts per date/location, supporting multiple users, and integrating with Supabase PostgreSQL & Storage (with zero-config local storage fallback).

---

## 🏗️ Folder Structure

```
MontlyTrevel Expencse/
├── backend/
│   ├── server.js                # Express API with Supabase/Firebase/Local fallback
│   ├── package.json             # Backend dependencies
│   └── .env.example             # Environment configuration template
├── supabase-schema.sql          # Supabase PostgreSQL DDL database schema
├── migrate-firebase-to-supabase.js # Zero-data-loss migration script
├── supabase-query.js            # CLI Database Query tool
├── sync-to-supabase.js          # Standalone cloud sync script
├── web/
│   ├── index.html               # Responsive Glassmorphic Dashboard
│   ├── style.css                # Custom CSS Design System & Micro-animations
│   └── app.js                   # Client state management & REST API caller
├── mobile-expo/                 # Expo React Native App Implementation
├── docs/
│   └── README.md                # Documentation & Architecture Guide
└── package.json                 # Unified root npm scripts
```

---

## ⚡ Quick Start (Run locally in 10 seconds!)

### 1. Install & Start Backend + Web Server
From the root project directory:
```bash
npm run install:backend
npm start
```
The server will start on `http://localhost:3000`:
- **Web App Dashboard**: `http://localhost:3000`
- **REST API Base**: `http://localhost:3000/api`

---

## ⚡ Supabase Setup & Migration Guide

1. **Create Database Tables**:
   Copy the contents of `supabase-schema.sql` and run it in your **Supabase Dashboard → SQL Editor**.

2. **Set Credentials in `backend/.env`**:
   ```env
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-supabase-service-role-or-anon-key
   ```

3. **Run Zero-Data-Loss Migration Script**:
   ```bash
   node migrate-firebase-to-supabase.js
   ```

4. **Query & Inspect Supabase Database**:
   ```bash
   node supabase-query.js TABLES
   node supabase-query.js GET users
   node supabase-query.js GET expenses
   ```

---

## 🗄️ Database Schema (Firebase Firestore)

### `users` Collection
```json
{
  "userId": "user_123",
  "name": "Subodh",
  "email": "subodh@email.com",
  "createdAt": "2026-08-15T12:00:00.000Z"
}
```

### `expenses` Collection
```json
{
  "expenseId": "exp_8a3f1b",
  "userId": "user_123",
  "date": "2026-07-09",
  "location": "Colaba One degree",
  "entries": [
    { "type": "Metro", "amount": 0 },
    { "type": "Local", "amount": 0 },
    { "type": "Auto/Rapido", "amount": 767 },
    { "type": "Others", "amount": 0 }
  ],
  "total": 767,
  "receipts": [
    {
      "fileName": "receipt1.jpg",
      "fileUrl": "https://storage.googleapis.com/...",
      "uploadedAt": "2026-07-09T14:30:00.000Z"
    }
  ],
  "createdAt": "2026-07-09T14:30:00.000Z",
  "updatedAt": "2026-07-09T14:30:00.000Z"
}
```

---

## 🔌 REST API Specifications

| Method | Endpoint | Description | Headers |
|--------|----------|-------------|---------|
| `GET` | `/api/health` | Check API & Storage mode status | None |
| `POST` | `/api/expenses` | Create travel expense entry | `user-id: <id>` |
| `GET` | `/api/expenses` | Get all expenses for active user | `user-id: <id>` |
| `GET` | `/api/expenses/date/:date` | Filter expenses by date | `user-id: <id>` |
| `POST` | `/api/expenses/:expenseId/receipts` | Upload receipt image/PDF | `user-id: <id>`, Multipart file `receipt` |
| `DELETE` | `/api/expenses/:expenseId/receipts/:fileName` | Delete receipt file | `user-id: <id>` |
| `DELETE` | `/api/expenses/:expenseId` | Delete entire expense & receipts | `user-id: <id>` |
| `GET` | `/api/stats` | Retrieve monthly expense KPIs & breakdown | `user-id: <id>` |

---

## 🔥 Firebase Setup Instructions (Optional)

If you wish to connect a live Firebase account:
1. Go to [Firebase Console](https://console.firebase.google.com/) and create a project.
2. Enable **Firestore Database** and **Firebase Storage**.
3. Go to **Project Settings > Service Accounts** and generate a new private key.
4. Save the generated JSON file as `backend/firebase-admin.json`.
5. Update `backend/.env` with your `FIREBASE_STORAGE_BUCKET`.
6. Restart backend: `npm start`.

---

## 📱 Mobile App (Flutter Setup)

To test or build the Flutter application:
```bash
cd mobile
flutter pub get
flutter run
```
To build Android APK:
```bash
flutter build apk --release
```

---

## ✅ Deployment Checklist

- [x] Node.js Express API created & tested
- [x] Excel format expense matrix renderer
- [x] Receipt file upload, viewer & deletion system
- [x] Multi-user header filtering support
- [x] Local storage fallback mode
- [x] Flutter mobile application code
- [x] Full documentation
