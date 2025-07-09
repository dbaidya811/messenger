# Real-Time Chat App

A modern, **real-time chat application** built with Node.js, Express and Socket.IO.  
It supports text, image & generic file sharing, message persistence, and an intuitive drag-and-drop deletion workflow that works on both desktop and mobile devices.

## ✨ Features

* **Real-time messaging** between registered users powered by Socket.IO.
* **File sharing** – send images, PDF & any file type (in-browser preview for images).
* **Persistent history** – messages are cached in `localStorage` per chat pair; reload-safe.
* **Select & delete** – double-click to select messages, then drag them into the floating trash-zone to delete.
* **Deletion sync** – deleted messages disappear for both sender & receiver and do not return after refresh.
* **Responsive UI** – mobile-friendly layout and CSS animations.
* **User management** – simple JSON‐based user list for sign-up / login.

## 📂 Project Structure

```
chat-app/
├── public/              # Static assets served by Express
│   ├── css/
│   │   └── chat.css
│   ├── js/
│   │   ├── app.js       # Login/dashboard logic
│   │   └── chat.js      # Chat room logic
│   ├── chat.html        # Chat room page
│   └── index.html       # Login / dashboard page
├── server.js            # Express + Socket.IO server
├── users.json           # Simple user store (replace with DB in prod)
└── README.md            # You are here
```

## 🚀 Quick Start

1. **Clone / download** the repo.
2. Install dependencies (only `express` & `socket.io`):

   ```bash
   npm install express socket.io
   ```
3. **Run the server**:

   ```bash
   node server.js
   ```
   The server starts on `http://localhost:3000` by default.
4. **Open the app** in your browser – two ways to test:
   * **Single machine**: open two tabs/windows with different accounts (use incognito for second user).
   * **LAN**: visit `http://<your-ip>:3000` from another device on the same network.

## 🗂️ Adding Users

Users are listed in `users.json`.  
Example entry:

```json
{
  "name": "Alice",
  "userId": "alice123",
  "email": "alice@example.com",
  "password": "secret"
}
```

Add two or more users, then restart the server.

> ⚠️ **Note:** Passwords are stored in **plain-text** for demonstration only. Use hashing & a database in production.

## 🔧 Development Notes

* Chat history & deleted-id cache are stored per user-pair in `localStorage` (`chat_history_<uid>_<peer>` & `deleted_ids_<pair>`).
* Message objects include a unique `id` sent with every socket event so clients can reconcile deletes.
* The trash-zone appears only when at least one message is selected and supports drag-over highlight.
* Socket.IO rooms: each user joins their own room (`socket.join(userId)`) so direct messages can be emitted to `to` & `from` rooms simultaneously.

## 🛣️ Future Improvements

* Persist messages & delete state on the **server** (DB) instead of client `localStorage`.
* **Auth tokens** & hashed passwords.
* Typing indicators, message read receipts.
* Chunked upload for large files.
* Unit & integration tests.

## 📜 License

MIT – free to use, modify & distribute.

---
Feel free to contribute or raise issues. Happy chatting! 🎉
