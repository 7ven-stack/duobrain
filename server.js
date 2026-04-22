const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const he = require('he');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

const rooms = {};

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const categoryMap = {
    science: 17, math: 19, music: 12, geography: 22, 
    history: 23, movies: 11, gaming: 15, sports: 21, mythology: 20
};

// --- Fallback Questions to prevent crashes ---
function getFallbackQuestions() {
    return [
        { q: "API Rate Limit Hit! Free Question: What is 2 + 2?", options: ["3", "4", "5", "6"], answer: 1 },
        { q: "Fallback Mode: Which programming language uses 'console.log'?", options: ["Python", "Java", "JavaScript", "C++"], answer: 2 },
        { q: "Fallback Mode: What is the capital of Japan?", options: ["Seoul", "Beijing", "Tokyo", "Bangkok"], answer: 2 },
        { q: "Fallback Mode: Who painted the Mona Lisa?", options: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"], answer: 1 },
        { q: "Fallback Mode: What is the chemical symbol for Gold?", options: ["Ag", "Au", "Fe", "Pb"], answer: 1 },
        { q: "Fallback Mode (Sudden Death): How many bits are in a byte?", options: ["4", "8", "16", "32"], answer: 1 }
    ];
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- NEW: Session Token Fetcher ---
async function getSessionToken() {
    try {
        const res = await fetch('https://opentdb.com/api_token.php?command=request');
        const data = await res.json();
        if (data.response_code === 0) return data.token;
    } catch (err) {
        console.error("Failed to fetch token:", err);
    }
    return null;
}

// --- UPDATED: API Fetcher now uses the Session Token ---
async function fetchQuestionsFromAPI(genre, difficulty = 'any', token = null, retries = 2) {
    const categoryId = categoryMap[genre] || 9; 
    const diffParam = difficulty !== 'any' ? `&difficulty=${difficulty}` : '';
    
    // Dynamically append the token if the room has one
    const tokenParam = token ? `&token=${token}` : '';
    const url = `https://opentdb.com/api.php?amount=6&category=${categoryId}${diffParam}&type=multiple${tokenParam}`;

    try {
        const response = await fetch(url);

        if (response.status === 429 && retries > 0) {
            console.log("⏳ API rate limited! Waiting 3 seconds to retry...");
            await delay(3000);
            return await fetchQuestionsFromAPI(genre, difficulty, token, retries - 1);
        }

        const data = await response.json();

        if (data.response_code === 5 && retries > 0) {
            console.log("⏳ OpenTDB rate limit hit! Waiting 3 seconds to retry...");
            await delay(3000);
            return await fetchQuestionsFromAPI(genre, difficulty, token, retries - 1);
        }

        // Code 4 means the token has seen every possible question in this category
        if (data.response_code === 4 && token) {
            console.log("🔄 Token exhausted! Resetting memory...");
            await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
            // Retry the exact same request now that the deck is shuffled
            return await fetchQuestionsFromAPI(genre, difficulty, token, retries);
        }

        if (data.response_code === 1) {
            console.warn(`⚠️ Not enough "${difficulty}" questions for ${genre}. Loading fallback...`);
            return getFallbackQuestions();
        }

        if (!data.results || data.response_code !== 0) {
            return getFallbackQuestions();
        }

        return data.results.map(item => {
            const question = he.decode(item.question);
            const correctAnswer = he.decode(item.correct_answer);
            const incorrectAnswers = item.incorrect_answers.map(ans => he.decode(ans));
            let options = [...incorrectAnswers, correctAnswer].sort(() => Math.random() - 0.5);
            return {
                q: question,
                options: options,
                answer: options.indexOf(correctAnswer) 
            };
        });
    } catch (err) {
        console.error("API Request Failed:", err);
        return getFallbackQuestions();
    }
}

io.on('connection', (socket) => {
    
    // UPDATED: Grab a token when a room is created
    socket.on('create-room', async (avatar, playerName, genre, difficulty) => {
        const roomId = generateRoomCode();
        
        // Ask OpenTDB for a memory tracker for this specific lobby
        const roomToken = await getSessionToken(); 
        const liveQuestions = await fetchQuestionsFromAPI(genre, difficulty, roomToken);
        
        rooms[roomId] = { 
            players: [], genre: genre, difficulty: difficulty, 
            answers: {}, questions: liveQuestions, token: roomToken 
        };
        
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, avatar, name: playerName, role: 'host' });
        socket.emit('room-created', roomId);
    });

    socket.on('join-room', (roomId, avatar, playerName) => {
        roomId = roomId.toUpperCase();
        if (!rooms[roomId]) return socket.emit('join-error', 'Room not found.');
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, avatar, name: playerName, role: 'guest' });
        io.to(roomId).emit('game-start', rooms[roomId].players, rooms[roomId].genre, roomId, rooms[roomId].questions);
    });

    socket.on('send-chat', (roomId, data) => socket.to(roomId).emit('receive-chat', data));

    socket.on('submit-answer', (roomId, answerIndex, timeRemaining) => {
        const room = rooms[roomId];
        if (!room) return;
        
        room.answers[socket.id] = { index: answerIndex, time: timeRemaining };

        if (Object.keys(room.answers).length === 2) {
            io.to(roomId).emit('round-results', room.answers);
            room.answers = {}; 
        } else {
            io.to(roomId).emit('player-waiting');
        }
    });

    socket.on('next-question', (roomId) => io.to(roomId).emit('load-next-question'));

    // UPDATED: Pass the token when rematching so OpenTDB remembers what you've played
    socket.on('play-again', async (roomId, newGenre, newDifficulty) => {
        const room = rooms[roomId];
        if (room) {
            room.genre = newGenre; 
            room.difficulty = newDifficulty;
            room.answers = {};
            room.questions = await fetchQuestionsFromAPI(newGenre, newDifficulty, room.token);
            io.to(roomId).emit('restart-game', newGenre, room.questions);
        }
    });

    socket.on('trigger-powerup', (roomId, type, playerName) => {
        socket.to(roomId).emit('enemy-powerup', type, playerName);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));