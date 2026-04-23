let socket = null;
const connectionStartTime = Date.now();

const myPersistentId = Math.random().toString(36).substring(2, 15);

const gameState = {
    roomId: null, genre: null, myPlayerId: null, role: null,
    currentQuestionIndex: 0, myScore: 0, enemyScore: 0, myName: "Me", questions: [],
    seriesMyScore: 0, seriesEnemyScore: 0 
};

let questionTimer = null;
let timeLeft = 20; 
let expectedEndTime = 0;
let isPaused = false;
let pausedRemainingMs = 0;
let tickSoundPlayedForSecond = -1; 
let powerUps = { fifty: false, freeze: false, jammer: false };
let isWaitingForOpponent = false; 

let pauseTimerInterval = null;
let pauseCountdown = 10;

// --- AUDIO ENGINE ---
const sfx = {
    click: new Audio('click.mp3'),
    tick: new Audio('tick.mp3'),
    win: new Audio('win.mp3'),
    lose: new Audio('lose.mp3'),
    bgm: new Audio('bgm.mp3') 
};

sfx.click.volume = 0.5; sfx.tick.volume = 0.6; sfx.win.volume = 0.6; sfx.lose.volume = 0.5; sfx.bgm.volume = 0.3; sfx.bgm.loop = true;

function playSound(audioObj) {
    if (!audioObj) return;
    audioObj.currentTime = 0; 
    const playPromise = audioObj.play();
    if (playPromise !== undefined) playPromise.catch(e => console.warn("Audio blocked"));
}

function stopSound(audioObj) {
    if (!audioObj) return;
    audioObj.pause();
    audioObj.currentTime = 0;
}

let bgmStarted = false;
function startBGM() {
    if (!bgmStarted) {
        const p = sfx.bgm.play();
        if (p !== undefined) p.then(() => { bgmStarted = true; }).catch(e => console.warn("BGM wait"));
    }
}
window.addEventListener('click', startBGM);

function showToast(message) {
    const tc = document.getElementById('toast-container');
    if(!tc) return;
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = message;
    tc.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

// --- DYNAMIC FUN FACTS LOGIC ---
const funFacts = [
    "The human brain generates about 20 watts of electricity—enough to power a dim light bulb!",
    "The first computer mouse was invented in 1964 and was made out of carved wood.",
    "The highest possible score in Pac-Man is exactly 3,333,360 points.",
    "A day on Venus is actually longer than a year on Venus.",
    "Honey never spoils. Archaeologists have found 3,000-year-old honey in Egyptian tombs that is still edible.",
    "Lightning strikes the Earth about 100 times every single second.",
    "Sharks have been around for over 400 million years, meaning they existed before trees.",
    "The Apollo 11 moon landing code was printed out and stood as tall as the software engineer who led the team.",
    "Ice is technically classified as a mineral.",
    "Owls don't have eyeballs. They have tube-shaped eyes that can't move, which is why they turn their heads."
];

function setHourlyFunFact() {
    const display = document.getElementById('fun-fact-display');
    if (!display) return;
    const now = new Date();
    const uniqueHourCounter = (now.getDate() * 24) + now.getHours();
    const factIndex = uniqueHourCounter % funFacts.length;
    display.innerHTML = funFacts[factIndex];
}

let mySelectedAvatar = "🦊"; 
let mySelectedGenre = "science"; 
let mySelectedDifficulty = "any";

const genrePacks = [
    ["science", "math", "music", "geography", "history", "movies", "gaming", "sports", "mythology"],
    ["computers", "anime", "books", "tv", "boardgames", "comics", "gadgets", "art", "animals"],
    ["general", "vehicles", "politics", "celebs", "theatre", "cartoons", "science", "geography", "music"] 
];

function injectDailyGenres(containerId, isRematch = false) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = ''; 

    const now = new Date();
    const daysSinceEpoch = Math.floor(now.getTime() / (1000 * 60 * 60 * 24));
    const activePack = genrePacks[daysSinceEpoch % genrePacks.length];

    if (!isRematch) mySelectedGenre = activePack[0]; 
    let selGenreForRematch = isRematch ? gameState.genre : null;
    
    if (isRematch && !activePack.includes(selGenreForRematch)) {
        selGenreForRematch = activePack[0];
    }

    activePack.forEach((g, i) => {
        const btn = document.createElement('div');
        btn.className = 'genre-option';
        
        if (!isRematch && i === 0) btn.classList.add('selected');
        if (isRematch && g === selGenreForRematch) btn.classList.add('selected');

        btn.textContent = g === "tv" ? "TV" : g.charAt(0).toUpperCase() + g.slice(1);
        btn.setAttribute('data-genre', g);
        
        btn.setAttribute('role', 'button');
        btn.setAttribute('tabindex', '0');
        btn.setAttribute('aria-label', `Select ${g} category`);

        btn.onkeydown = (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                btn.click();
            }
        };

        btn.onclick = (e) => {
            playSound(sfx.click);
            container.querySelectorAll('.genre-option').forEach(o => o.classList.remove('selected'));
            e.target.classList.add('selected');
            if (!isRematch) mySelectedGenre = g;
        };
        container.appendChild(btn);
    });

    return selGenreForRematch; 
}


// --- NETWORK EVENTS ---
socket = io('/');

socket.on('connect', () => {
    const overlay = document.getElementById('entry-overlay');
    
    if (overlay && !overlay.classList.contains('hidden-element')) {
        const ping = Date.now() - connectionStartTime;
        const statusText = overlay.querySelector('p');
        
        if (statusText) {
            statusText.innerHTML = `Connected! <span style="color:white; font-size: 0.9rem;">(${ping}ms ping)</span>`;
            statusText.style.color = '#10b981'; 
            statusText.style.animation = 'none'; 
        }
        setTimeout(() => overlay.classList.add('hidden-element'), 600); 
    }

    if (gameState.roomId) {
        socket.emit('reconnect-player', gameState.roomId, myPersistentId);
    }
});

socket.on('pause-game', (playerName) => {
    isPaused = true;
    pausedRemainingMs = expectedEndTime - Date.now(); 
    
    const pauseModal = document.getElementById('pause-overlay');
    const pauseText = document.getElementById('pause-text');
    
    if (pauseModal && pauseText) {
        pauseCountdown = 10;
        pauseText.textContent = `${playerName} disconnected. Waiting ${pauseCountdown}s...`;
        pauseModal.classList.remove('hidden-element');
        
        clearInterval(pauseTimerInterval);
        
        pauseTimerInterval = setInterval(() => {
            pauseCountdown--;
            if(pauseCountdown > 0) {
                pauseText.textContent = `${playerName} disconnected. Waiting ${pauseCountdown}s...`;
            } else {
                pauseText.textContent = `${playerName} disconnected. Waiting 0s...`;
                clearInterval(pauseTimerInterval);
            }
        }, 1000);
    }
});

socket.on('resume-game', () => {
    clearInterval(pauseTimerInterval); 
    if (!isPaused) return;
    isPaused = false;
    expectedEndTime = Date.now() + pausedRemainingMs; 
    showToast(`Opponent reconnected! Game resuming.`);
    
    const pauseModal = document.getElementById('pause-overlay');
    if (pauseModal) pauseModal.classList.add('hidden-element');
});

socket.on('default-win', () => {
    clearInterval(questionTimer);
    clearInterval(pauseTimerInterval); 
    isWaitingForOpponent = false;
    
    const pauseModal = document.getElementById('pause-overlay');
    if (pauseModal) pauseModal.classList.add('hidden-element');
    
    document.getElementById('powerups-ui').style.display = 'none';
    
    document.getElementById('question-text').textContent = "Match Forfeited";

    optsContainer.innerHTML = `
        <div style="background: rgba(16, 185, 129, 0.1); padding: 25px; border-radius: 12px; text-align: center; grid-column: 1 / -1; border: 2px dashed #10b981;">
            <h2 style="color: #10b981; font-size: 2rem; margin-bottom: 10px;">VICTORY</h2>
            <p style="color: white; font-size: 1.1rem;">Opponent forfeited the match.</p>
        </div>
        <button id="back-menu-forfeit" class="secondary-btn" style="margin-top: 20px; grid-column: 1 / -1;">Back to Main Menu</button>
    `;
    
    document.getElementById('back-menu-forfeit').onclick = () => {
        playSound(sfx.click);
        setTimeout(() => window.location.reload(), 150);
    };
    
    document.getElementById('turn-indicator').textContent = "Forfeit";
    document.querySelector('.chat-container').classList.add('expanded-chat');

    sfx.bgm.volume = 0.1;
    playSound(sfx.win);
    setTimeout(() => { sfx.bgm.volume = 0.3; }, 4000);
});

socket.on('room-created', id => { 
    document.getElementById('room-code-display').textContent = id; 
    gameState.roomId = id;
    switchScreen(screens.lobby); 
});

socket.on('join-error', (errorMessage) => {
    showToast(errorMessage);
    playSound(sfx.lose);
});

socket.on('opponent-disconnected', () => {
    clearInterval(pauseTimerInterval); 
    showToast(`Opponent disconnected! Returning to menu...`);
    playSound(sfx.lose);
    setTimeout(() => window.location.reload(), 2500);
});

socket.on('game-start', (players, genre, roomId, sanitizedQuestions) => {
    resetPowerUps(); 
    document.getElementById('help-btn').style.display = 'none'; 
    document.querySelector('.chat-container').classList.remove('expanded-chat'); 
    document.getElementById('bg-video').classList.remove('sudden-death-bg'); 
    
    gameState.roomId = roomId; gameState.genre = genre; gameState.myPlayerId = socket.id; gameState.questions = sanitizedQuestions;
    const me = players.find(p => p.id === socket.id); const them = players.find(p => p.id !== socket.id);
    gameState.role = me.role;
    
    document.getElementById('my-avatar-display').textContent = me.avatar;
    document.getElementById('remote-avatar-display').textContent = them.avatar;
    document.getElementById('remote-label').textContent = them.name;
    
    startCountdownSequence();
});

socket.on('round-results', (answers, correctAns) => {
    clearInterval(questionTimer);
    stopSound(sfx.tick);
    
    isWaitingForOpponent = false;
    
    timerDisplay.classList.add('hidden-element');
    optsContainer.classList.remove('options-grid'); 

    const q = gameState.questions[gameState.currentQuestionIndex];
    q.answer = correctAns; 

    const myData = answers[socket.id];
    const enemyId = Object.keys(answers).find(id => id !== socket.id);
    const enemyData = answers[enemyId];

    const myAns = myData.index;
    const enemyAns = enemyData.index;

    if (gameState.currentQuestionIndex < 5) {
        if (myAns === q.answer) gameState.myScore++;
        if (enemyAns === q.answer) gameState.enemyScore++;
    } else if (gameState.currentQuestionIndex === 5) {
        if (myAns === q.answer && enemyAns !== q.answer) {
            gameState.myScore++;
        } else if (enemyAns === q.answer && myAns !== q.answer) {
            gameState.enemyScore++;
        } else if (myAns === q.answer && enemyAns === q.answer) {
            if (myData.time > enemyData.time) {
                gameState.myScore++; 
            } else if (enemyData.time > myData.time) {
                gameState.enemyScore++;
            }
        }
    }

    document.getElementById('p1-score-display').textContent = `Me: ${gameState.myScore}`;
    document.getElementById('p2-score-display').textContent = `Opponent: ${gameState.enemyScore}`;

    let goNext = false;
    let isSuddenDeathTrigger = false;

    if (gameState.currentQuestionIndex < 4) {
        goNext = true; 
    } else if (gameState.currentQuestionIndex === 4 && gameState.myScore === gameState.enemyScore) {
        goNext = true; 
        isSuddenDeathTrigger = true;
    }

    if (goNext) {
        optsContainer.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); padding: 15px 20px; border-radius: 12px; text-align: left;">
                <p style="margin-bottom:6px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Round Review</p>
                <p style="margin-bottom:6px; font-size: 1.05rem;">Answer: <strong style="color:var(--primary-color);">${q.options[q.answer]}</strong></p>
                <p style="margin-bottom:4px; font-size:0.95rem;">You: ${myAns === -1 ? 'Timeout' : q.options[myAns]} <span class="${myAns === q.answer ? 'text-correct' : 'text-incorrect'}">${myAns === q.answer ? '(Correct)' : '(Incorrect)'}</span></p>
                <p style="font-size:0.95rem;">Enemy: ${enemyAns === -1 ? 'Timeout' : q.options[enemyAns]} <span class="${enemyAns === q.answer ? 'text-correct' : 'text-incorrect'}">${enemyAns === q.answer ? '(Correct)' : '(Incorrect)'}</span></p>
            </div>
            ${isSuddenDeathTrigger ? `<h3 style="color:#ef4444; margin-top:15px; text-align:center; font-size: 1.2rem;">WARNING: SUDDEN DEATH NEXT</h3>` : ``}
        `;

        if (gameState.role === 'host') {
            const nextBtn = document.createElement('button');
            nextBtn.className = 'primary-btn'; nextBtn.style.marginTop = '15px';
            nextBtn.textContent = isSuddenDeathTrigger ? 'Enter Sudden Death' : 'Next Question';
            if (isSuddenDeathTrigger) nextBtn.style.backgroundColor = '#ef4444';
            nextBtn.onclick = () => socket.emit('next-question', gameState.roomId);
            optsContainer.appendChild(nextBtn);
        } else {
             const waitingText = document.createElement('h3');
             waitingText.style.cssText = "margin-top: 15px; color: var(--text-muted); text-align: center; animation: pulse 1.5s infinite;";
             waitingText.textContent = "Waiting for host...";
             optsContainer.appendChild(waitingText);
        }
    } else {
        document.getElementById('powerups-ui').style.display = 'none'; 
        document.getElementById('question-text').textContent = "Match Complete";
        document.getElementById('turn-indicator').textContent = "Final";
        document.querySelector('.chat-container').classList.add('expanded-chat');

        let res = gameState.myScore > gameState.enemyScore ? "Victory" : (gameState.myScore < gameState.enemyScore ? "Defeat" : "Draw");
        let cls = gameState.myScore > gameState.enemyScore ? "victory-color" : (gameState.myScore < gameState.enemyScore ? "defeat-color" : "draw-color");
        
        if (res === "Victory") gameState.seriesMyScore++;
        else if (res === "Defeat") gameState.seriesEnemyScore++;
        document.getElementById('series-score-display').textContent = `Series: ${gameState.seriesMyScore} - ${gameState.seriesEnemyScore}`;

        sfx.bgm.volume = 0.1;
        if (res === "Victory") playSound(sfx.win); else playSound(sfx.lose);
        setTimeout(() => { sfx.bgm.volume = 0.3; }, 4000);

        let flavorText = "";
        if (res === "Victory") flavorText = "Great job, you dominated!";
        else if (res === "Defeat") flavorText = "Better luck next time!";
        else flavorText = "A perfectly matched battle!";

        optsContainer.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 10px;">
                <p style="margin-bottom:8px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Match Summary</p>
                <p style="font-size: 1.2rem; font-weight: 800; margin-bottom: 5px;">Final Score: <span style="color: var(--primary-color);">${gameState.myScore} - ${gameState.enemyScore}</span></p>
                <p style="font-size: 0.85rem; color: var(--text-muted);">${flavorText}</p>
            </div>
            <div class="winner-banner"><h2 class="winner-text ${cls}">${res}</h2></div>
        `;

        if (gameState.role === 'host') {
            const rb = document.createElement('div');
            rb.className = 'rematch-box';
            
            rb.innerHTML = `
                <h3 style="margin-bottom: 15px;">Play Again?</h3>
                <div class="genre-selector" id="rematch-genre" style="margin-bottom: 10px;"></div>
                <h4 style="margin: 10px 0 10px; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; text-align: left; font-weight: 800;">Difficulty</h4>
                <div class="genre-selector" id="rematch-difficulty" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 15px;"></div>
                <div style="display: flex; gap: 10px;">
                    <button id="rematch-btn" class="primary-btn">Start Rematch</button>
                    <button id="back-menu-btn" class="secondary-btn">Main Menu</button>
                </div>
            `;
            optsContainer.appendChild(rb);
            
            let selGenre = injectDailyGenres('rematch-genre', true);

            const rdiff = document.getElementById('rematch-difficulty');
            let selDiff = "any";
            
            [ {id: 'any', text: 'Any'}, {id: 'easy', text: 'Easy'}, {id: 'medium', text: 'Med'}, {id: 'hard', text: 'Hard'} ].forEach(d => {
                const p = document.createElement('div'); p.className = 'genre-option'; p.textContent = d.text; p.onclick = (e) => {
                    playSound(sfx.click);
                    rdiff.querySelectorAll('.genre-option').forEach(o => o.classList.remove('selected'));
                    e.target.classList.add('selected'); selDiff = d.id;
                };
                
                p.setAttribute('role', 'button');
                p.setAttribute('tabindex', '0');
                p.setAttribute('aria-label', `${d.text} Difficulty`);
                p.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); p.click(); }};

                if(d.id === 'any') p.classList.add('selected');
                rdiff.appendChild(p);
            });
            
            document.getElementById('rematch-btn').onclick = () => {
                playSound(sfx.click);
                const activeGenreBtn = document.querySelector('#rematch-genre .genre-option.selected');
                const finalGenre = activeGenreBtn ? activeGenreBtn.getAttribute('data-genre') : selGenre;
                socket.emit('play-again', gameState.roomId, finalGenre, selDiff);
            };

            document.getElementById('back-menu-btn').onclick = () => {
                playSound(sfx.click);
                setTimeout(() => window.location.reload(), 150);
            };

        } else {
            const waitingBox = document.createElement('div');
            waitingBox.className = 'rematch-box'; 
            waitingBox.style.opacity = '0.8';
            
            waitingBox.innerHTML = `
                <h3 style="margin-bottom: 8px; color: var(--text-muted);">Waiting on Host</h3>
                <div style="padding: 15px 0;">
                    <p style="font-size: 0.85rem; color: var(--primary-color); font-weight: 700; animation: pulse 1.5s infinite;">
                        Host is setting up the next round...
                    </p>
                </div>
                <button id="back-menu-btn-guest" class="secondary-btn" style="margin-top: 15px;">Leave to Main Menu</button>
            `;
            optsContainer.appendChild(waitingBox);

            document.getElementById('back-menu-btn-guest').onclick = () => {
                playSound(sfx.click);
                setTimeout(() => window.location.reload(), 150);
            };
        }
    }
});

socket.on('load-next-question', () => { gameState.currentQuestionIndex++; renderQuestion(); });

socket.on('restart-game', (g, sanitizedQuestions) => { 
    clearInterval(pauseTimerInterval); 
    resetPowerUps();
    isWaitingForOpponent = false;
    document.getElementById('help-btn').style.display = 'none';
    document.querySelector('.chat-container').classList.remove('expanded-chat'); 
    document.getElementById('bg-video').classList.remove('sudden-death-bg');
    gameState.genre = g; gameState.questions = sanitizedQuestions;
    gameState.currentQuestionIndex = 0; gameState.myScore = 0; gameState.enemyScore = 0; 
    
    startCountdownSequence();
});

socket.on('enemy-powerup', (type, enemyName) => {
    if(type === '5050') showToast(`<strong>${enemyName}</strong> used Decrypt!`);
    
    if(type === 'freeze') {
        showToast(`<strong>${enemyName}</strong> overclocked their timer!`);
        timerDisplay.classList.remove('ice-flash');
        void timerDisplay.offsetWidth; 
        timerDisplay.classList.add('ice-flash');
    }
    
    if(type === 'jammer') {
        showToast(`<strong>${enemyName}</strong> glitched your screen!`);
        playSound(sfx.lose); 
        optsContainer.classList.add('jammed-state');
        
        const vig = document.getElementById('jammer-vignette');
        vig.classList.add('vignette-active');
        
        setTimeout(() => { 
            optsContainer.classList.remove('jammed-state'); 
            vig.classList.remove('vignette-active');
        }, 5000); 
    }
});

socket.on('receive-chat', d => { playSound(sfx.click); addMsg(d.name, d.text, false); });

// --- INITIALIZATION ON LOAD ---
document.addEventListener('DOMContentLoaded', () => {
    
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isInAppBrowser = (ua.indexOf("FBAN") > -1) || (ua.indexOf("FBAV") > -1) || (ua.indexOf("Instagram") > -1) || (ua.indexOf("TikTok") > -1);
    
    if (isInAppBrowser) {
        document.getElementById('inapp-warning').classList.remove('hidden-element');
        document.querySelector('.app-container').style.display = 'none';
        
        const overlay = document.getElementById('entry-overlay');
        if(overlay) overlay.style.display = 'none';

        return; 
    }

    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) document.getElementById('room-input').value = roomParam;
    
    setHourlyFunFact();
    injectDailyGenres('host-genre');

    document.querySelectorAll('.avatar-option, #host-difficulty .genre-option').forEach(el => {
        el.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                el.click();
            }
        });
    });
});

const screens = { 
    menu: document.getElementById('menu-screen'), 
    lobby: document.getElementById('lobby-screen'), 
    countdown: document.getElementById('countdown-screen'),
    quiz: document.getElementById('quiz-screen') 
};
const timerDisplay = document.getElementById('timer-display');
const optsContainer = document.getElementById('options-container');

function switchScreen(screenToActivate) {
    Object.values(screens).forEach(s => s.classList.replace('active-screen', 'hidden-screen'));
    screenToActivate.classList.replace('hidden-screen', 'active-screen');
}

// --- RULES MODAL LOGIC ---
const rulesModal = document.getElementById('rules-modal');
document.getElementById('help-btn').onclick = () => {
    playSound(sfx.click);
    rulesModal.classList.remove('hidden-element');
};
document.getElementById('close-rules-btn').onclick = () => {
    playSound(sfx.click);
    rulesModal.classList.add('hidden-element');
};
rulesModal.onclick = (e) => {
    if (e.target === rulesModal) {
        playSound(sfx.click);
        rulesModal.classList.add('hidden-element');
    }
};

// --- POWER-UPS LOGIC ---
function resetPowerUps() {
    powerUps = { fifty: false, freeze: false, jammer: false };
    document.querySelectorAll('.pu-btn').forEach(btn => btn.classList.remove('used'));
    document.getElementById('powerups-ui').style.display = 'flex';
}

document.getElementById('pu-5050').onclick = function() {
    if (powerUps.fifty || gameState.currentQuestionIndex >= 6) return;
    powerUps.fifty = true; this.classList.add('used'); playSound(sfx.click);
    showToast("You activated Decrypt!");
    
    if(socket) socket.emit('trigger-powerup', gameState.roomId, '5050', gameState.myName);

    const q = gameState.questions[gameState.currentQuestionIndex];
    const buttons = document.querySelectorAll('.option-btn');
    
    q.removableIndices.forEach(idx => {
        if (idx !== undefined && buttons[idx] && !buttons[idx].disabled) {
            buttons[idx].style.opacity = '0.2';
            buttons[idx].disabled = true;
        }
    });
};

document.getElementById('pu-freeze').onclick = function() {
    if (powerUps.freeze || gameState.currentQuestionIndex >= 6) return;
    powerUps.freeze = true; this.classList.add('used'); playSound(sfx.click);
    
    showToast("You activated Overclock!");
    if(socket) socket.emit('trigger-powerup', gameState.roomId, 'freeze', gameState.myName);
    
    expectedEndTime += 8000; 
    
    timerDisplay.textContent = `${Math.ceil((expectedEndTime - Date.now())/1000)}s`;
    timerDisplay.classList.add('frozen-text');
};

document.getElementById('pu-jammer').onclick = function() {
    if (powerUps.jammer || gameState.currentQuestionIndex >= 6) return;
    powerUps.jammer = true; this.classList.add('used'); playSound(sfx.click);
    showToast("You glitched their screen!");
    if(socket) socket.emit('trigger-powerup', gameState.roomId, 'jammer', gameState.myName);
};

// --- MENU HANDLERS ---
document.querySelectorAll('.avatar-option').forEach(option => {
    option.onclick = (e) => {
        playSound(sfx.click);
        const parent = e.target.closest('.avatar-selector');
        parent.querySelectorAll('.avatar-option').forEach(opt => opt.classList.remove('selected'));
        e.target.classList.add('selected');
        mySelectedAvatar = e.target.getAttribute('data-avatar');
    };
});

document.querySelectorAll('#host-difficulty .genre-option').forEach(option => {
    option.onclick = (e) => {
        playSound(sfx.click);
        document.querySelectorAll('#host-difficulty .genre-option').forEach(opt => opt.classList.remove('selected'));
        e.target.classList.add('selected');
        mySelectedDifficulty = e.target.getAttribute('data-difficulty');
    };
});

document.getElementById('create-btn').onclick = () => {
    playSound(sfx.click);
    const n = document.getElementById('host-name').value || "Host";
    gameState.myName = n;
    if(socket) socket.emit('create-room', mySelectedAvatar, n, mySelectedGenre, mySelectedDifficulty, myPersistentId);
};

document.getElementById('copy-link-btn').onclick = () => {
    playSound(sfx.click);
    const link = `${window.location.origin}/?room=${gameState.roomId}`;
    if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(link); showToast("Invite link copied!");
    } else {
        const tempInput = document.createElement('input'); tempInput.value = link; document.body.appendChild(tempInput); tempInput.select(); document.execCommand('copy'); document.body.removeChild(tempInput); showToast("Invite link copied!");
    }
};

document.getElementById('join-btn').onclick = () => {
    playSound(sfx.click);
    const n = document.getElementById('guest-name').value || "Guest";
    const c = document.getElementById('room-input').value;
    if(!c) return;
    gameState.myName = n;
    if(socket) socket.emit('join-room', c.toUpperCase(), mySelectedAvatar, n, myPersistentId);
};

function startCountdownSequence() {
    switchScreen(screens.countdown);
    let count = 3;
    const countText = document.getElementById('countdown-text');
    countText.textContent = count;
    countText.classList.add('countdown-pulse');
    playSound(sfx.tick);
    
    const countInterval = setInterval(() => {
        count--;
        if (count > 0) {
            countText.textContent = count;
            playSound(sfx.tick);
        } else {
            clearInterval(countInterval);
            countText.classList.remove('countdown-pulse');
            switchScreen(screens.quiz);
            renderQuestion();
        }
    }, 1000);
}

function renderQuestion() {
    stopSound(sfx.tick);
    
    optsContainer.classList.remove('jammed-state'); 
    optsContainer.classList.add('options-grid'); 
    
    const currentQ = gameState.questions[gameState.currentQuestionIndex];
    document.getElementById('question-text').textContent = currentQ.q;
    
    isPaused = false;
    let durationSec = (gameState.currentQuestionIndex === 5) ? 7 : 20;
    timeLeft = durationSec;
    expectedEndTime = Date.now() + (durationSec * 1000);
    tickSoundPlayedForSecond = -1;

    if (gameState.currentQuestionIndex === 5) {
        document.getElementById('turn-indicator').innerHTML = `<span class="sudden-death-text">SUDDEN DEATH</span>`;
        document.getElementById('bg-video').classList.add('sudden-death-bg');
    } else {
        document.getElementById('turn-indicator').textContent = `Round ${gameState.currentQuestionIndex + 1}`;
        document.getElementById('bg-video').classList.remove('sudden-death-bg');
    }
    
    optsContainer.innerHTML = '';
    timerDisplay.classList.remove('hidden-element');
    timerDisplay.textContent = `${timeLeft}s`;
    clearInterval(questionTimer);

    questionTimer = setInterval(() => {
        if (isPaused) return;

        const remainingMs = expectedEndTime - Date.now();
        timeLeft = Math.ceil(remainingMs / 1000);

        if (timeLeft <= 0) {
            timeLeft = 0;
            timerDisplay.textContent = `0s`;
            clearInterval(questionTimer);
            stopSound(sfx.tick); 
            
            isWaitingForOpponent = true;

            if(socket) socket.emit('submit-answer', gameState.roomId, -1, 0);
            
            optsContainer.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 25px; background: rgba(239, 68, 68, 0.1); border-radius: 16px; border: 2px dashed #ef4444;">
                    <h3 style="color: #ef4444; margin-bottom: 10px; font-size: 1.5rem; text-shadow: 0 0 15px #ef4444;">Time's Up!</h3>
                    <p style="color: white; font-size: 1rem; font-weight: 700; animation: pulse 1.5s infinite;">Waiting for opponent...</p>
                </div>
            `;
            return;
        }

        timerDisplay.textContent = `${timeLeft}s`;
        
        if (timeLeft <= 5 && timeLeft > 0) {
            timerDisplay.classList.add('timer-warning'); 
            
            if (tickSoundPlayedForSecond !== timeLeft) {
                playSound(sfx.tick);
                tickSoundPlayedForSecond = timeLeft;
            }
        } else {
            timerDisplay.classList.remove('timer-warning');
        }

    }, 100);

    currentQ.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn'; btn.textContent = opt;
        
        btn.setAttribute('aria-label', `Select ${opt}`);
        btn.onclick = () => {
            playSound(sfx.click); 
            clearInterval(questionTimer);
            stopSound(sfx.tick);
            
            isWaitingForOpponent = true;

            if(socket) socket.emit('submit-answer', gameState.roomId, i, timeLeft);
            
            optsContainer.innerHTML = `
                <div style="grid-column: 1 / -1; text-align: center; padding: 25px; background: rgba(56, 189, 248, 0.1); border-radius: 16px; border: 2px dashed #38bdf8;">
                    <h3 style="color: #38bdf8; margin-bottom: 10px; font-size: 1.5rem; text-shadow: 0 0 15px #38bdf8;">Answer Locked</h3>
                    <p style="color: white; font-size: 1rem; font-weight: 700; animation: pulse 1.5s infinite;">Waiting for opponent...</p>
                </div>
            `;
        };
        optsContainer.appendChild(btn);
    });
}

// --- CHAT SYSTEM ---
const chatIn = document.getElementById('chat-input');
const chatMsgs = document.getElementById('chat-messages');

const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const emojiList = ['😀','😂','🤣','😊','😍','😭','🥺','😎','🔥','👍','❤️','✨','💀','💯','🤔','🙌','👀','🤯','🎉','💪'];

emojiList.forEach(emoji => {
    const span = document.createElement('span');
    span.className = 'emoji-item';
    span.textContent = emoji;
    span.setAttribute('role', 'button');
    span.setAttribute('tabindex', '0');
    span.setAttribute('aria-label', emoji);
    
    span.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            span.click();
        }
    };
    span.onclick = () => {
        playSound(sfx.click);
        chatIn.value += emoji;
        chatIn.focus();
    };
    emojiPicker.appendChild(span);
});

emojiBtn.onclick = (e) => {
    e.stopPropagation();
    playSound(sfx.click);
    emojiPicker.classList.toggle('hidden-element');
};

document.addEventListener('click', (e) => {
    if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) {
        emojiPicker.classList.add('hidden-element');
    }
});

function addMsg(n, t, me) {
    const d = document.createElement('div'); d.className = `chat-bubble ${me ? 'me' : 'them'}`;
    d.innerHTML = `<strong>${n}:</strong> `;
    d.appendChild(document.createTextNode(t));
    chatMsgs.appendChild(d); chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

document.getElementById('send-chat-btn').onclick = () => {
    playSound(sfx.click);
    const t = chatIn.value.trim(); if(!t) return;
    if(socket) socket.emit('send-chat', gameState.roomId, { name: gameState.myName, text: t });
    addMsg("You", t, true); chatIn.value = "";
};
chatIn.onkeypress = (e) => { if(e.key === 'Enter') document.getElementById('send-chat-btn').click(); };