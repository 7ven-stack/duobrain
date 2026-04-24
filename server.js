require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const he = require('he');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

// Connect to MongoDB using an Environment Variable for security
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
    .then(() => console.log("Connected to DuoBrain MongoDB!"))
    .catch(err => console.error("MongoDB Connection Error:", err));

const QuestionSchema = new mongoose.Schema({
    category: Number,
    difficulty: String,
    question: String,
    correct_answer: String,
    incorrect_answers: [String]
});
const Question = mongoose.model('Question', QuestionSchema);

const rooms = {};
const socketToRoom = {}; 

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

const categoryMap = {
    science: 17, math: 19, music: 12, geography: 22, 
    history: 23, movies: 11, gaming: 15, sports: 21, mythology: 20,
    computers: 18, anime: 31, books: 10, tv: 14, boardgames: 16,
    comics: 29, gadgets: 30, art: 25, animals: 27,
    general: 9, vehicles: 28, politics: 24, celebs: 26, theatre: 13, cartoons: 32
};

function getFallbackQuestions() {
    return [
        { q: "Server Offline! Free Question: What is 2 + 2?", options: ["3", "4", "5", "6"], answer: 1, removableIndices: [0, 2] },
        { q: "Fallback Mode: Which programming language uses 'console.log'?", options: ["Python", "Java", "JavaScript", "C++"], answer: 2, removableIndices: [0, 1] },
        { q: "Fallback Mode: What is the capital of Japan?", options: ["Seoul", "Beijing", "Tokyo", "Bangkok"], answer: 2, removableIndices: [0, 3] },
        { q: "Fallback Mode: Who painted the Mona Lisa?", options: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"], answer: 1, removableIndices: [2, 3] },
        { q: "Fallback Mode: What is the chemical symbol for Gold?", options: ["Ag", "Au", "Fe", "Pb"], answer: 1, removableIndices: [0, 3] },
        { q: "Fallback Mode (Sudden Death): How many bits are in a byte?", options: ["4", "8", "16", "32"], answer: 1, removableIndices: [0, 3] }
    ];
}

async function fetchQuestionsFromDB(genre, difficulty = 'any') {
    const categoryId = categoryMap[genre] || 9; 
    
    let matchFilter = { category: categoryId };
    if (difficulty !== 'any') {
        matchFilter.difficulty = difficulty;
    }

    try {
        let rawQuestions = await Question.aggregate([
            { $match: matchFilter },
            { $sample: { size: 6 } }
        ]);

        if ((!rawQuestions || rawQuestions.length < 6) && difficulty !== 'any') {
            console.log(`Not enough ${difficulty} questions for category ${categoryId}. Smart Fallback to ANY difficulty.`);
            rawQuestions = await Question.aggregate([
                { $match: { category: categoryId } },
                { $sample: { size: 6 } }
            ]);
        }

        if (!rawQuestions || rawQuestions.length < 6) {
            console.log(`Database empty for category ${categoryId}. Using fallbacks.`);
            return getFallbackQuestions();
        }

        return rawQuestions.map(item => {
            const question = he.decode(item.question);
            const correctAnswer = he.decode(item.correct_answer);
            const incorrectAnswers = item.incorrect_answers.map(ans => he.decode(ans));
            
            let options = [...incorrectAnswers, correctAnswer].sort(() => Math.random() - 0.5);
            const correctIdx = options.indexOf(correctAnswer);
            
            const wrongIndices = [];
            options.forEach((opt, idx) => { if (idx !== correctIdx) wrongIndices.push(idx); });
            const shuffledWrong = wrongIndices.sort(() => Math.random() - 0.5);
            
            const removableIndices = [];
            if (shuffledWrong.length > 0) removableIndices.push(shuffledWrong[0]);
            if (shuffledWrong.length > 1) removableIndices.push(shuffledWrong[1]);

            return {
                q: question, options: options, answer: correctIdx, removableIndices: removableIndices 
            };
        });
    } catch (err) {
        console.error("Database query failed:", err);
        return getFallbackQuestions();
    }
}

function updateGlobalStats() {
    const playersOnline = io.engine.clientsCount;
    const activeMatches = Object.keys(rooms).length;
    io.emit('global-stats', playersOnline, activeMatches);
}

io.on('connection', (socket) => {
    updateGlobalStats();

    socket.on('create-room', async (avatar, playerName, genre, difficulty, playerId) => {
        const roomId = generateRoomCode();
        rooms[roomId] = { 
            players: [], genre: genre, difficulty: difficulty, answers: {}, questions: [], 
            currentQuestionIndex: 0, wagers: {}, status: 'lobby', disconnectTimer: null 
        };
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, playerId: playerId, avatar, name: playerName, role: 'host', connected: true });
        socketToRoom[socket.id] = roomId; 
        socket.emit('room-created', roomId);
        updateGlobalStats(); 
    });

    socket.on('join-room', (roomId, avatar, playerName, playerId) => {
        roomId = roomId.toUpperCase();
        if (!rooms[roomId]) return socket.emit('join-error', 'Room not found.');
        if (rooms[roomId].status !== 'lobby') return socket.emit('join-error', 'Game already in progress.');
        
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, playerId: playerId, avatar, name: playerName, role: 'guest', connected: true });
        socketToRoom[socket.id] = roomId;

        socket.emit('room-joined', roomId, rooms[roomId].genre, rooms[roomId].difficulty);
        socket.to(roomId).emit('player-joined', playerName);
    });

    socket.on('update-settings', (roomId, genre, difficulty) => {
        if (rooms[roomId] && rooms[roomId].status === 'lobby') {
            rooms[roomId].genre = genre;
            rooms[roomId].difficulty = difficulty;
            socket.to(roomId).emit('settings-updated', genre, difficulty);
        }
    });

    socket.on('update-rematch-settings', (roomId, genre, difficulty) => {
        socket.to(roomId).emit('rematch-settings-updated', genre, difficulty);
    });

    socket.on('start-game', async (roomId) => {
        const room = rooms[roomId];
        if (room && room.players.length === 2 && room.status === 'lobby') {
            room.status = 'playing';
            room.questions = await fetchQuestionsFromDB(room.genre, room.difficulty);
            
            const sanitizedQuestions = room.questions.map(q => ({ 
                q: q.q, options: q.options, removableIndices: q.removableIndices 
            }));
            
            io.to(roomId).emit('game-start', room.players, room.genre, roomId, sanitizedQuestions);
        }
    });

    socket.on('send-chat', (roomId, data) => socket.to(roomId).emit('receive-chat', data));

    socket.on('submit-answer', (roomId, answerIndex, timeRemaining) => {
        const room = rooms[roomId];
        if (!room) return;
        
        room.answers[socket.id] = { index: answerIndex, time: timeRemaining };

        if (Object.keys(room.answers).length === 2) {
            const correctAns = room.questions[room.currentQuestionIndex].answer;
            io.to(roomId).emit('round-results', room.answers, correctAns);
            room.answers = {}; 
        } else {
            io.to(roomId).emit('player-waiting');
        }
    });

    socket.on('next-question', (roomId) => {
        const room = rooms[roomId];
        if (room) {
            room.currentQuestionIndex++;
            if (room.currentQuestionIndex === 4) {
                io.to(roomId).emit('start-wager-phase', room.genre);
            } else {
                io.to(roomId).emit('load-next-question');
            }
        }
    });

    socket.on('submit-wager', (roomId, amount) => {
        const room = rooms[roomId];
        if (!room) return;
        room.wagers[socket.id] = amount;
        
        if (Object.keys(room.wagers).length === 2) {
            io.to(roomId).emit('wager-phase-complete', room.wagers);
            setTimeout(() => {
                io.to(roomId).emit('load-next-question');
            }, 2500); 
        }
    });

    socket.on('match-finished', (roomId) => {
        if (rooms[roomId]) {
            rooms[roomId].status = 'finished';
        }
    });

    socket.on('play-again', async (roomId, newGenre, newDifficulty) => {
        const room = rooms[roomId];
        if (room) {
            room.genre = newGenre; 
            room.difficulty = newDifficulty;
            room.answers = {};
            room.wagers = {}; 
            room.currentQuestionIndex = 0; 
            room.status = 'playing'; 
            room.questions = await fetchQuestionsFromDB(newGenre, newDifficulty);
            
            const sanitizedQuestions = room.questions.map(q => ({ 
                q: q.q, options: q.options, removableIndices: q.removableIndices 
            }));
            
            io.to(roomId).emit('restart-game', newGenre, sanitizedQuestions);
        }
    });

    socket.on('trigger-powerup', (roomId, type, playerName) => socket.to(roomId).emit('enemy-powerup', type, playerName));

    socket.on('reconnect-player', (roomId, playerId) => {
        if (rooms[roomId]) {
            const room = rooms[roomId];
            const player = room.players.find(p => p.playerId === playerId);
            if (player && !player.connected) {
                player.id = socket.id;
                player.connected = true;
                socketToRoom[socket.id] = roomId;
                socket.join(roomId);
                if (room.players.every(p => p.connected)) {
                    clearTimeout(room.disconnectTimer);
                    room.disconnectTimer = null;
                    io.to(roomId).emit('resume-game');
                }
            }
        }
    });

    socket.on('disconnect', () => {
        const roomId = socketToRoom[socket.id];
        if (roomId && rooms[roomId]) {
            const room = rooms[roomId];
            delete socketToRoom[socket.id]; 

            const player = room.players.find(p => p.id === socket.id);
            if (player) player.connected = false;

            if (room.players.every(p => !p.connected)) {
                clearTimeout(room.disconnectTimer);
                delete rooms[roomId];
            } else if (room.players.length === 2 && room.status === 'playing') {
                io.to(roomId).emit('pause-game', player ? player.name : 'Opponent');

                room.disconnectTimer = setTimeout(() => {
                    io.to(roomId).emit('default-win');
                    room.players.forEach(p => { if (p.connected) delete socketToRoom[p.id]; });
                    delete rooms[roomId];
                    updateGlobalStats(); 
                }, 10000); 
            } else {
                socket.to(roomId).emit('opponent-disconnected');
                delete rooms[roomId];
            }
        }
        
        updateGlobalStats();
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));