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

// Helper function to let the server pause for a few seconds
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// --- UPDATED: API Fetcher with Auto-Retry and Difficulty ---
async function fetchQuestionsFromAPI(genre, difficulty = 'any', retries = 2) {
    const categoryId = categoryMap[genre] || 9; 
    const diffParam = difficulty !== 'any' ? `&difficulty=${difficulty}` : '';
    const url = `https://opentdb.com/api.php?amount=6&category=${categoryId}${diffParam}&type=multiple`;

    try {
        const response = await fetch(url);

        // HTTP 429 means "Too Many Requests"
        if (response.status === 429 && retries > 0) {
            console.log("⏳ API rate limited! Waiting 3 seconds to retry...");
            await delay(3000);
            return await fetchQuestionsFromAPI(genre, difficulty, retries - 1);
        }

        const data = await response.json();

        // OpenTDB Code 5 also means "Rate Limit Hit"
        if (data.response_code === 5 && retries > 0) {
            console.log("⏳ OpenTDB rate limit hit! Waiting 3 seconds to retry...");
            await delay(3000);
            return await fetchQuestionsFromAPI(genre, difficulty, retries - 1);
        }

        // Code 1 means not enough questions exist in that specific category/difficulty
        if (data.response_code === 1) {
            console.warn(`⚠️ Not enough "${difficulty}" questions for ${genre}. Loading fallback...`);
            return getFallbackQuestions();
        }

        // General failure catch
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
    
    socket.on('create-room', async (avatar, playerName, genre, difficulty) => {
        const roomId = generateRoomCode();
        const liveQuestions = await fetchQuestionsFromAPI(genre, difficulty);
        
        rooms[roomId] = { players: [], genre: genre, difficulty: difficulty, answers: {}, questions: liveQuestions };
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

    socket.on('play-again', async (roomId, newGenre, newDifficulty) => {
        const room = rooms[roomId];
        if (room) {
            room.genre = newGenre; 
            room.difficulty = newDifficulty;
            room.answers = {};
            room.questions = await fetchQuestionsFromAPI(newGenre, newDifficulty);
            io.to(roomId).emit('restart-game', newGenre, room.questions);
        }
    });

    socket.on('trigger-powerup', (roomId, type, playerName) => {
        socket.to(roomId).emit('enemy-powerup', type, playerName);
    });
});

// --- CLOUD DEPLOYMENT FIX ---
// The cloud provider will automatically set process.env.PORT
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));