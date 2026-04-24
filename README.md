# DuoBrain

![DuoBrain](https://img.shields.io/badge/Status-Live-success) ![Version](https://img.shields.io/badge/Version-1.0.0-blue)

**DuoBrain** is a fast-paced, real-time 1v1 multiplayer trivia battle game. Go head-to-head against opponents, strategically deploy power-ups to disrupt their gameplay, and risk it all in high-stakes Wager and Sudden Death rounds.

**Live Demo:** [Play DuoBrain](https://duobrain-h60q.onrender.com)

---

## Features

* **Real-Time Multiplayer:** Instant matchmaking and synchronized gameplay powered by WebSockets (Socket.io).
* **Dynamic Trivia Engine:** Access to over 3,500+ questions securely stored in a cloud MongoDB Atlas cluster, spanning 20+ safe and active categories.
* **Smart Data Fallback Engine:** An intelligent server-side architecture that dynamically adjusts query constraints on the fly to guarantee match stability, even if specific category/difficulty permutations are exhausted from the database.
* **Strategic Power-Ups:** * **Decrypt:** Instantly removes two incorrect answers.
    * **Overclock:** Adds 8 seconds to your timer.
    * **Glitch:** Visually disrupts your opponent's screen with CSS animations and CSS-filter blurs to cause chaos.
* **High-Stakes Game Modes:** Includes a Round 5 "Wager Phase" for massive point swings, and a high-pressure "Sudden Death" finale where speed dictates the winner.
* **Live Chat System:** Fully integrated real-time chat.

---

## Tech Stack

* **Backend:** Node.js, Express.js
* **Real-Time Communication:** Socket.io
* **Database:** MongoDB Atlas & Mongoose
* **Security:** `dotenv` for environment variable management
* **Frontend:** Vanilla HTML5, CSS3, JavaScript (Zero frameworks, highly optimized DOM manipulation)
* **Deployment:** Render Web Services

---

## Local Installation

Want to run DuoBrain locally or host your own instance?

1.  **Clone the repository:**
    ```bash
    git clone [https://github.com/yourusername/duobrain.git](https://github.com/yourusername/duobrain.git)
    cd duobrain
    ```

2.  **Install dependencies:**
    ```bash
    npm install express socket.io mongoose he dotenv
    ```

3.  **Configure Environment Variables:**
    Create a `.env` file in the root directory and add your MongoDB connection string:
    ```text
    MONGO_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
    ```

4.  **Seed the Database:**
    Populate your MongoDB cluster with the ultimate trivia seeder script (fetches thousands of questions via the OpenTDB API across all difficulties):
    ```bash
    node seeder.js
    ```

5.  **Start the Server:**
    ```bash
    node server.js
    ```
    The game will be available at `https://duobrain-h60q.onrender.com/`.

---

## Developer

Developed by **7VEN**
*Built for Fun <3
