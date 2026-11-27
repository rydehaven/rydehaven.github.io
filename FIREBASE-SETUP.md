# Switching on Rydehaven chat (Firebase)

Chat runs on Firebase Realtime Database, Google's free online database. Riders sign in anonymously (no email or password),
and the security rules in `firebase-rules.json` check every message.

## 1. Create the project
1. Go to https://console.firebase.google.com and sign in with a Google account.
2. Click **Create a project**, name it `Rydehaven`, and turn Google Analytics **off**. Click **Create project**.

## 2. Turn on anonymous sign-in
1. In the left menu: **Build › Authentication › Get started**.
2. Open the **Sign-in method** tab, click **Anonymous**, switch it **on**, and **Save**.

## 3. Create the database
1. Left menu: **Build › Realtime Database › Create Database**.
2. Pick a location near most riders (United States is fine), then choose **Start in locked mode** and **Enable**.
3. Open the **Rules** tab, delete everything there, paste the whole contents of `firebase-rules.json`, and click **Publish**.
4. Back on the **Data** tab, copy the address at the top (it looks like `https://rydehaven-default-rtdb.firebaseio.com`).

## 4. Get the web key
1. Click the gear next to **Project Overview › Project settings**.
2. Under **Your apps**, click the **</>** (web) button, name it `Rydehaven`, and click **Register app** (no hosting needed).
3. Copy the `apiKey` value shown.

## 5. Put the two values in the game
In `app/js/chat.js`, fill in:

```js
export const CHAT_CONFIG = {
  apiKey: 'paste the apiKey here',
  databaseURL: 'paste the database address here',
};
```

The web key isn't a password: Firebase web keys are meant to be in the app. The rules are what keep the database safe.

## What the rules allow
- Only signed-in riders can read or write chat.
- A message must be from your own rider id, 1–140 characters, with a name up to 24 characters.
- Messages can't be edited or deleted by riders, and their time comes from Firebase's clock.
- Each rider can send at most one message every 2 seconds.
- Nothing else in the database can be read or written.

The free plan allows 100 riders connected at once and 1 GB of stored data, plenty for testing.
