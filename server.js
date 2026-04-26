require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const he = require('he');
const mongoose = require('mongoose');

const app = express();
const server = http.createServer(app);

// Use a fast 10-second ping to detect connection drops immediately
const io = new Server(server, {
    pingInterval: 10000, 
    pingTimeout: 5000    
});

app.use(express.static('public'));

// Connect to MongoDB with a 5-second timeout to prevent infinite hanging
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 5000 })
    .then(() => console.log("Connected to DuoBrain MongoDB!"))
    .catch(err => console.error("MongoDB Connection Error. Is your IP whitelisted on Atlas?:", err));

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

async function fetchQuestionsFromDB(genre, difficulty = 'any', amount = 6) {
    const categoryId = categoryMap[genre] || 9; 
    let matchFilter = { category: categoryId };
    if (difficulty !== 'any') {
        matchFilter.difficulty = difficulty;
    }

    try {
        let rawQuestions = await Question.aggregate([
            { $match: matchFilter },
            { $sample: { size: amount } }
        ]);

        if ((!rawQuestions || rawQuestions.length < amount) && difficulty !== 'any') {
            rawQuestions = await Question.aggregate([
                { $match: { category: categoryId } },
                { $sample: { size: amount } }
            ]);
        }

        if (!rawQuestions || rawQuestions.length < amount) {
            rawQuestions = await Question.aggregate([
                { $match: { category: 9 } },
                { $sample: { size: amount } }
            ]);
        }

        if (!rawQuestions || rawQuestions.length < amount) {
            rawQuestions = await Question.aggregate([
                { $sample: { size: amount } }
            ]);
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
        throw err; 
    }
}

function updateGlobalStats() {
    const playersOnline = io.engine.clientsCount;
    const activeMatches = Object.keys(rooms).length;
    io.emit('global-stats', playersOnline, activeMatches);
}

io.on('connection', (socket) => {
    updateGlobalStats();

    socket.on('ping-test', (clientTime, callback) => {
        if (typeof callback === 'function') callback(clientTime);
    });

    socket.on('create-room', async (avatar, playerName, genre, difficulty, playerId) => {
        const roomId = generateRoomCode();
        rooms[roomId] = { 
            players: [], genre: genre, difficulty: difficulty, answers: {}, questions: [], 
            currentQuestionIndex: 0, wagers: {}, status: 'lobby', disconnectTimer: null, scores: {}, powerupsUsed: {}, questionStartTime: 0
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
        if (rooms[roomId].players.length >= 2) return socket.emit('join-error', 'Room is full.');
        
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
            room.status = 'fetching'; 
            
            try {
                room.questions = await fetchQuestionsFromDB(room.genre, room.difficulty);
                
                if (!room.questions || room.questions.length < 6) {
                    throw new Error("Not enough questions loaded from the database.");
                }

                const sanitizedQuestions = room.questions.map(q => ({ 
                    q: q.q, options: q.options, removableIndices: q.removableIndices 
                }));
                
                room.players.forEach(p => room.scores[p.playerId] = 0);
                room.status = 'playing';
                room.questionStartTime = Date.now();
                io.to(roomId).emit('game-start', room.players, room.genre, roomId, sanitizedQuestions);
            } catch (error) {
                console.error("Game Start Error:", error);
                room.status = 'lobby'; 
                socket.emit('game-start-error', "Database connection failed. Please check your internet or DB server.");
            }
        }
    });


    socket.on('send-chat', (roomId, data) => {
        if (data && data.text) {
            data.text = String(data.text).substring(0, 200);
            socket.to(roomId).emit('receive-chat', data);
        }
    });

    // SENIOR DEV FIX: Map answers to persistent playerId, not volatile socket.id
    socket.on('submit-answer', (roomId, answerIndex, timeRemaining, playerId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        // Calculate real time taken instead of trusting client
        const realTimeTaken = Date.now() - room.questionStartTime;
        room.answers[playerId] = { index: answerIndex, time: realTimeTaken };

        if (Object.keys(room.answers).length === 2) {
            const correctAns = room.questions[room.currentQuestionIndex].answer;
            
            const playerIds = Object.keys(room.answers);
            const p1 = playerIds[0];
            const p2 = playerIds[1];
            const ans1 = room.answers[p1];
            const ans2 = room.answers[p2];

            if (room.currentQuestionIndex < 4) {
                if (ans1.index === correctAns) room.scores[p1]++;
                if (ans2.index === correctAns) room.scores[p2]++;
            } else if (room.currentQuestionIndex === 4) {
                if (ans1.index === correctAns) room.scores[p1] += (room.wagers[p1] || 0);
                else room.scores[p1] -= (room.wagers[p1] || 0);

                if (ans2.index === correctAns) room.scores[p2] += (room.wagers[p2] || 0);
                else room.scores[p2] -= (room.wagers[p2] || 0);
            } else if (room.currentQuestionIndex === 5) {
                if (ans1.index === correctAns && ans2.index !== correctAns) {
                    room.scores[p1]++;
                } else if (ans2.index === correctAns && ans1.index !== correctAns) {
                    room.scores[p2]++;
                } else if (ans1.index === correctAns && ans2.index === correctAns) {
                    if (ans1.time < ans2.time) room.scores[p1]++;
                    else if (ans2.time < ans1.time) room.scores[p2]++;
                }
            }

            io.to(roomId).emit('round-results', room.answers, correctAns, room.scores);
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
                room.questionStartTime = Date.now();
                io.to(roomId).emit('load-next-question');
            }
        }
    });

    // SENIOR DEV FIX: Map wagers to persistent playerId and validate
    socket.on('submit-wager', (roomId, amount, playerId) => {
        const room = rooms[roomId];
        if (!room) return;
        
        let safeAmount = parseInt(amount);
        if (isNaN(safeAmount) || safeAmount < 1 || safeAmount > 3) safeAmount = 1;
        
        room.wagers[playerId] = safeAmount;
        
        if (Object.keys(room.wagers).length === 2) {
            io.to(roomId).emit('wager-phase-complete', room.wagers);
            setTimeout(() => {
                room.questionStartTime = Date.now();
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
        if (room && room.status !== 'fetching') {
            room.status = 'fetching';
            try {
                room.genre = newGenre; 
                room.difficulty = newDifficulty;
                room.answers = {};
                room.wagers = {}; 
                room.currentQuestionIndex = 0; 
                room.powerupsUsed = {};
                room.questionStartTime = Date.now();
                Object.keys(room.scores).forEach(id => room.scores[id] = 0);
                room.questions = await fetchQuestionsFromDB(newGenre, newDifficulty);
                
                const sanitizedQuestions = room.questions.map(q => ({ 
                    q: q.q, options: q.options, removableIndices: q.removableIndices 
                }));
                
                room.status = 'playing';
                io.to(roomId).emit('restart-game', newGenre, sanitizedQuestions);
            } catch (error) {
                console.error("Rematch Error:", error);
                room.status = 'finished';
                socket.emit('game-start-error', "Failed to load rematch questions.");
            }
        }
    });

    socket.on('trigger-powerup', (roomId, type, playerName) => {
        const room = rooms[roomId];
        if (room) {
            const player = room.players.find(p => p.id === socket.id);
            if (player) {
                if (!room.powerupsUsed[player.playerId]) room.powerupsUsed[player.playerId] = {};
                if (!room.powerupsUsed[player.playerId][type]) {
                    room.powerupsUsed[player.playerId][type] = true;
                    socket.to(roomId).emit('enemy-powerup', type, playerName);
                }
            }
        }
    });

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
                    
                    const otherPlayer = room.players.find(p => p.id !== socket.id);
                    if (otherPlayer) {
                        const sanitizedQuestions = room.questions ? room.questions.map(q => ({ 
                            q: q.q, options: q.options, removableIndices: q.removableIndices 
                        })) : [];
                        
                        const syncData = {
                            roomId: roomId,
                            genre: room.genre,
                            questions: sanitizedQuestions,
                            currentIndex: room.currentQuestionIndex,
                            myScore: room.scores[playerId] || 0,
                            enemyScore: room.scores[otherPlayer.playerId] || 0,
                            myWager: room.wagers[playerId] || null,
                            enemyWager: room.wagers[otherPlayer.playerId] || null,
                            avatarMe: player.avatar,
                            avatarThem: otherPlayer.avatar,
                            nameThem: otherPlayer.name
                        };
                        io.to(socket.id).emit('recover-game', syncData);
                    }
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

                // 30-second Grace Period for player to reconnect
                room.disconnectTimer = setTimeout(() => {
                    io.to(roomId).emit('default-win');
                    room.players.forEach(p => { if (p.connected) delete socketToRoom[p.id]; });
                    delete rooms[roomId];
                    updateGlobalStats(); 
                }, 30000); 
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