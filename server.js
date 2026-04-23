const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const he = require('he');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));

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
        { q: "API Rate Limit Hit! Free Question: What is 2 + 2?", options: ["3", "4", "5", "6"], answer: 1, removableIndices: [0, 2] },
        { q: "Fallback Mode: Which programming language uses 'console.log'?", options: ["Python", "Java", "JavaScript", "C++"], answer: 2, removableIndices: [0, 1] },
        { q: "Fallback Mode: What is the capital of Japan?", options: ["Seoul", "Beijing", "Tokyo", "Bangkok"], answer: 2, removableIndices: [0, 3] },
        { q: "Fallback Mode: Who painted the Mona Lisa?", options: ["Van Gogh", "Da Vinci", "Picasso", "Rembrandt"], answer: 1, removableIndices: [2, 3] },
        { q: "Fallback Mode: What is the chemical symbol for Gold?", options: ["Ag", "Au", "Fe", "Pb"], answer: 1, removableIndices: [0, 3] },
        { q: "Fallback Mode (Sudden Death): How many bits are in a byte?", options: ["4", "8", "16", "32"], answer: 1, removableIndices: [0, 3] }
    ];
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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

async function fetchQuestionsFromAPI(genre, difficulty = 'any', token = null, retries = 2) {
    const categoryId = categoryMap[genre] || 9; 
    const diffParam = difficulty !== 'any' ? `&difficulty=${difficulty}` : '';
    
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

        if (data.response_code === 4 && token) {
            console.log("🔄 Token exhausted! Resetting memory...");
            await fetch(`https://opentdb.com/api_token.php?command=reset&token=${token}`);
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
            
            const correctIdx = options.indexOf(correctAnswer);
            
            const wrongIndices = [];
            options.forEach((opt, idx) => { if (idx !== correctIdx) wrongIndices.push(idx); });
            const shuffledWrong = wrongIndices.sort(() => Math.random() - 0.5);
            
            const removableIndices = [];
            if (shuffledWrong.length > 0) removableIndices.push(shuffledWrong[0]);
            if (shuffledWrong.length > 1) removableIndices.push(shuffledWrong[1]);

            return {
                q: question,
                options: options,
                answer: correctIdx,             
                removableIndices: removableIndices 
            };
        });
    } catch (err) {
        console.error("API Request Failed:", err);
        return getFallbackQuestions();
    }
}

io.on('connection', (socket) => {
    
    socket.on('create-room', async (avatar, playerName, genre, difficulty, playerId) => {
        const roomId = generateRoomCode();
        const roomToken = await getSessionToken(); 
        const liveQuestions = await fetchQuestionsFromAPI(genre, difficulty, roomToken);
        
        rooms[roomId] = { 
            players: [], genre: genre, difficulty: difficulty, 
            answers: {}, questions: liveQuestions, token: roomToken,
            currentQuestionIndex: 0,
            status: 'playing', // NEW: Server tracks if the game is active!
            disconnectTimer: null 
        };
        
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, playerId: playerId, avatar, name: playerName, role: 'host', connected: true });
        
        socketToRoom[socket.id] = roomId; 
        
        socket.emit('room-created', roomId);
    });

    socket.on('join-room', (roomId, avatar, playerName, playerId) => {
        roomId = roomId.toUpperCase();
        if (!rooms[roomId]) return socket.emit('join-error', 'Room not found.');
        
        socket.join(roomId);
        rooms[roomId].players.push({ id: socket.id, playerId: playerId, avatar, name: playerName, role: 'guest', connected: true });
        
        socketToRoom[socket.id] = roomId;

        const sanitizedQuestions = rooms[roomId].questions.map(q => ({ 
            q: q.q, options: q.options, removableIndices: q.removableIndices 
        }));
        
        io.to(roomId).emit('game-start', rooms[roomId].players, rooms[roomId].genre, roomId, sanitizedQuestions);
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
            
            // NEW: If we just finished round 6, mark the game as finished
            if (room.currentQuestionIndex >= 5) {
                room.status = 'finished';
            }
        } else {
            io.to(roomId).emit('player-waiting');
        }
    });

    socket.on('next-question', (roomId) => {
        if (rooms[roomId]) rooms[roomId].currentQuestionIndex++;
        io.to(roomId).emit('load-next-question')
    });

    socket.on('play-again', async (roomId, newGenre, newDifficulty) => {
        const room = rooms[roomId];
        if (room) {
            room.genre = newGenre; 
            room.difficulty = newDifficulty;
            room.answers = {};
            room.currentQuestionIndex = 0; 
            room.status = 'playing'; // NEW: Reset status to active for the rematch
            room.questions = await fetchQuestionsFromAPI(newGenre, newDifficulty, room.token);
            
            const sanitizedQuestions = room.questions.map(q => ({ 
                q: q.q, options: q.options, removableIndices: q.removableIndices 
            }));
            
            io.to(roomId).emit('restart-game', newGenre, sanitizedQuestions);
        }
    });

    socket.on('trigger-powerup', (roomId, type, playerName) => {
        socket.to(roomId).emit('enemy-powerup', type, playerName);
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
                return;
            }

            // NEW: Only trigger the 10-second grace period if the game is actively playing!
            if (room.players.length === 2 && room.status === 'playing') {
                io.to(roomId).emit('pause-game', player ? player.name : 'Opponent');

                room.disconnectTimer = setTimeout(() => {
                    io.to(roomId).emit('default-win');
                    
                    room.players.forEach(p => {
                        if (p.connected) delete socketToRoom[p.id];
                    });
                    delete rooms[roomId];
                }, 10000); 
            } else {
                // If they are on the Match Complete screen, just return the remaining player to the menu safely.
                socket.to(roomId).emit('opponent-disconnected');
                delete rooms[roomId];
            }
        }
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));