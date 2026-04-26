let socket = null;
const connectionStartTime = Date.now();

const memoryStorage = {};
function safeGetItem(key) { try { return localStorage.getItem(key) || memoryStorage[key]; } catch(e) { return memoryStorage[key]; } }
function safeSetItem(key, val) { try { localStorage.setItem(key, val); } catch(e) { memoryStorage[key] = val; } }
function safeRemoveItem(key) { try { localStorage.removeItem(key); } catch(e) { delete memoryStorage[key]; } }

let myPersistentId = safeGetItem('duobrain_user_id');
if (!myPersistentId) {
    myPersistentId = Math.random().toString(36).substring(2, 15);
    safeSetItem('duobrain_user_id', myPersistentId);
}

const gameState = {
    roomId: null, genre: null, difficulty: null, myPlayerId: null, role: null,
    currentQuestionIndex: 0, myScore: 0, enemyScore: 0, myName: "Player", questions: [],
    seriesMyScore: 0, seriesEnemyScore: 0,
    myWager: null, enemyWager: null
};

let questionTimer = null;
let countdownTimer = null; 
let timeLeft = 20; 
let expectedEndTime = 0;
let isPaused = false;
let pausedRemainingMs = 0;
let tickSoundPlayedForSecond = -1; 
let powerUps = { fifty: false, freeze: false, jammer: false };
let isWaitingForOpponent = false; 
let isMatchFinished = false; 

let pauseTimerInterval = null;
let pauseCountdown = 30; // 30 second grace period for disconnects

// --- SAFE BACKGROUND UPDATER ---
function updateBackground(isSuddenDeath) {
    const bgEl = document.getElementById('bg-image') || document.getElementById('bg-video');
    if (!bgEl) return; 
    
    if (isSuddenDeath) {
        bgEl.classList.add('sudden-death-bg');
    } else {
        bgEl.classList.remove('sudden-death-bg');
    }
}

// --- BULLETPROOF AUDIO ENGINE (WEB AUDIO API) ---
const AudioContext = window.AudioContext || window.webkitAudioContext;
const audioCtx = new AudioContext();
const masterGain = audioCtx.createGain();
masterGain.connect(audioCtx.destination);
masterGain.gain.value = 1;

const audioBuffers = {};

async function loadAudio(name, url) {
    try {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
        audioBuffers[name] = audioBuffer;
    } catch (e) {
        console.error(`Failed to load audio: ${name}`, e);
    }
}

// Pre-load all SFX into memory for 0ms latency
loadAudio('click', 'click.mp3');
loadAudio('tick', 'tick.mp3');
loadAudio('notif', 'notif.mp3');
loadAudio('win', 'win.mp3');
loadAudio('lose', 'lose.mp3');
loadAudio('bgm', 'bgm.mp3');

const sfx = {
    click: { name: 'click', vol: 0.5 },
    tick: { name: 'tick', vol: 0.6 },
    notif: { name: 'notif', vol: 0.7 },
    win: { name: 'win', vol: 0.6 },
    lose: { name: 'lose', vol: 0.5 },
    bgm: { name: 'bgm', vol: 0.3 }
};

function playSound(audioObj) {
    if (!audioObj || !audioBuffers[audioObj.name]) return;
    
    // Prevent overlapping for tick to avoid phasing
    if (audioObj.name === 'tick') {
        stopSound(audioObj);
    }
    
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffers[audioObj.name];
    
    const gainNode = audioCtx.createGain();
    gainNode.gain.value = audioObj.vol;
    
    source.connect(gainNode);
    gainNode.connect(masterGain);
    
    source.start(0);
    
    audioObj.activeSources = audioObj.activeSources || [];
    audioObj.activeSources.push({ source, gainNode });
    
    source.onended = () => {
        const i = audioObj.activeSources.findIndex(s => s.source === source);
        if (i > -1) audioObj.activeSources.splice(i, 1);
    };
    
    return source;
}

function stopSound(audioObj) {
    if (audioObj && audioObj.activeSources) {
        audioObj.activeSources.forEach(s => {
            try { 
                // Smooth fade-out to prevent "popping" or "weird" zero-crossing artifacts
                s.gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.015);
                setTimeout(() => { try { s.source.stop(); } catch(e) {} }, 60);
            } catch(e) {}
        });
        audioObj.activeSources = [];
    }
}

let isGlobalMuted = false;
const muteBtn = document.getElementById('mute-btn');
if (muteBtn) {
    muteBtn.onclick = (e) => {
        isGlobalMuted = !isGlobalMuted;
        const iconOn = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>`;
        const iconOff = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>`;
        muteBtn.innerHTML = isGlobalMuted ? iconOff : iconOn;
        masterGain.gain.value = isGlobalMuted ? 0 : 1;
    };
}


// --- PROCEDURAL AUDIO SYNTHESIZERS ---
function playDecryptSound() {
    if (isGlobalMuted || audioCtx.state === 'suspended') return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'square';
        osc.connect(gain);
        gain.connect(masterGain);
        
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        osc.frequency.setValueAtTime(1200, audioCtx.currentTime + 0.1);
        osc.frequency.setValueAtTime(1600, audioCtx.currentTime + 0.2);
        
        gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.3);
    } catch(e) { console.error('Decrypt SFX error:', e); }
}

function playOverclockSound() {
    if (isGlobalMuted || audioCtx.state === 'suspended') return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain);
        gain.connect(masterGain);
        
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.6);
        
        gain.gain.setValueAtTime(0, audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.15, audioCtx.currentTime + 0.2);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.6);
        
        osc.start();
        osc.stop(audioCtx.currentTime + 0.6);
    } catch(e) { console.error('Overclock SFX error:', e); }
}

function playGlitchSound() {
    if (isGlobalMuted || audioCtx.state === 'suspended') return;
    try {
        const bufferSize = audioCtx.sampleRate * 0.5;
        const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
        const data = buffer.getChannelData(0);
        
        let lastOut = 0;
        for (let i = 0; i < bufferSize; i++) {
            let white = Math.random() * 2 - 1;
            data[i] = (lastOut + (0.02 * white)) / 1.02;
            lastOut = data[i];
            data[i] *= 3.5;
        }
        
        const noise = audioCtx.createBufferSource();
        noise.buffer = buffer;
        
        const filter = audioCtx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1000, audioCtx.currentTime);
        filter.frequency.exponentialRampToValueAtTime(100, audioCtx.currentTime + 0.5);
        
        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.5);
        
        noise.connect(filter);
        filter.connect(gain);
        gain.connect(masterGain);
        
        noise.start();
    } catch(e) { console.error('Glitch SFX error:', e); }
}

let bgmStarted = false;
function startBGM() {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    if (!bgmStarted && audioBuffers['bgm']) {
        bgmStarted = true;
        const bgmSource = audioCtx.createBufferSource();
        bgmSource.buffer = audioBuffers['bgm'];
        bgmSource.loop = true;
        
        const gainNode = audioCtx.createGain();
        gainNode.gain.value = sfx.bgm.vol;
        
        bgmSource.connect(gainNode);
        gainNode.connect(masterGain);
        bgmSource.start(0);
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

// --- PROFILE SETUP LOGIC ---
let mySelectedAvatar = "🦊"; 
let mySelectedGenre = "science"; 
let mySelectedDifficulty = "any";

const profileOverlay = document.getElementById('profile-setup-overlay');
const setupNameInput = document.getElementById('setup-name');
const saveProfileBtn = document.getElementById('save-profile-btn');

function initProfile() {
    const savedName = safeGetItem('duobrain_name');
    let savedAvatar = safeGetItem('duobrain_avatar');

    if (savedAvatar === 'Fox') savedAvatar = '🦊';
    else if (savedAvatar === 'Panda') savedAvatar = '🐼';
    else if (savedAvatar === 'Tiger') savedAvatar = '🐯';
    else if (savedAvatar === 'Frog') savedAvatar = '🐸';

    if (savedName && savedAvatar) {
        gameState.myName = savedName;
        mySelectedAvatar = savedAvatar;
        safeSetItem('duobrain_avatar', mySelectedAvatar);
        updateMiniProfileDisplay();
    }
}


function renderAvatar(avatarData) {
    if (!avatarData) return '??';
    if (avatarData.startsWith('data:image/')) {
        return `<img src="${avatarData}" class="custom-avatar-img">`;
    }
    return avatarData;
}

function updateMiniProfileDisplay() {
    const disp = document.getElementById('menu-profile-display');
    if (disp) {
        disp.innerHTML = `<span class="cyber-avatar" style="font-size:1.2rem;">${renderAvatar(mySelectedAvatar)}</span>`;
    }
}

document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(opt => {
    opt.onclick = (e) => {
        if (opt.id === 'custom-avatar-btn') return;
        playSound(sfx.click);
        document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(o => o.classList.remove('selected'));
        opt.classList.add('selected');
        mySelectedAvatar = opt.getAttribute('data-avatar');
    };
});

const customAvatarBtn = document.getElementById('custom-avatar-btn');
const customAvatarInput = document.getElementById('custom-avatar-input');

if (customAvatarBtn && customAvatarInput) {
    customAvatarBtn.onclick = () => {
        playSound(sfx.click);
        customAvatarInput.click();
    };

    customAvatarInput.onchange = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 128;
                canvas.height = 128;
                const ctx = canvas.getContext('2d');
                
                const size = Math.min(img.width, img.height);
                const startX = (img.width - size) / 2;
                const startY = (img.height - size) / 2;
                
                ctx.drawImage(img, startX, startY, size, size, 0, 0, 128, 128);
                const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);
                
                mySelectedAvatar = compressedBase64;
                
                document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(o => o.classList.remove('selected'));
                customAvatarBtn.classList.add('selected');
                customAvatarBtn.innerHTML = `<img src="${compressedBase64}" class="custom-avatar-img">`;
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };
}

saveProfileBtn.onclick = () => {
    const n = setupNameInput.value.trim();
    if (!n) {
        showToast("Please enter a name!");
        return;
    }
    playSound(sfx.click);
    gameState.myName = n;
    safeSetItem('duobrain_name', n);
    safeSetItem('duobrain_avatar', mySelectedAvatar);
    
    profileOverlay.classList.add('hidden-element');
    profileOverlay.style.display = 'none';
    updateMiniProfileDisplay();
};

document.getElementById('menu-profile-display').onclick = () => {
    playSound(sfx.click);
    setupNameInput.value = gameState.myName;
    
    document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(o => {
        o.classList.remove('selected');
        if (o.getAttribute('data-avatar') === mySelectedAvatar) {
            o.classList.add('selected');
        }
        if (mySelectedAvatar && mySelectedAvatar.startsWith('data:image/') && o.id === 'custom-avatar-btn') {
            o.classList.add('selected');
            o.innerHTML = `<img src="${mySelectedAvatar}" class="custom-avatar-img">`;
        }
    });
    
    profileOverlay.classList.remove('hidden-element');
    profileOverlay.style.display = 'flex';
};

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

const proTips = [
    "Save your Decrypt power-up for Round 5's Clutch Phase to secure a massive point swing!",
    "Using the Glitch power-up during Sudden Death causes maximum panic.",
    "Overclock adds 8 seconds to your timer. Use it when you need time to think!",
    "Clutch Rounds can make or break a match. Don't risk 3 points unless you're confident.",
    "In Sudden Death, speed matters just as much as accuracy. Be the first to answer!",
    "If both players answer correctly, the one who answered faster gets the point.",
    "Pay attention to the Category before Round 5 starts so you can plan your risk.",
    "You only get one of each power-up per match. Don't waste them early!",
    "A Glitch power-up shakes the enemy's screen and blurs their answers for 5 seconds.",
    "The host controls the category and difficulty. Pick your strongest subjects!"
];

let currentFactTypewriter = null;
function setHourlyFunFact() {
    const display = document.getElementById('fun-fact-display');
    if (!display) return;
    const now = new Date();
    const uniqueHourCounter = (now.getDate() * 24) + now.getHours();
    const factIndex = uniqueHourCounter % funFacts.length;
    
    if (currentFactTypewriter) clearInterval(currentFactTypewriter);
    currentFactTypewriter = typewriterEffect(display, funFacts[factIndex], 15);
}

let currentTipIndex = 0;
let currentTipTypewriter = null;

function initProTips() {
    const display = document.getElementById('pro-tip-display');
    if (!display) return;
    
    currentTipIndex = Math.floor(Math.random() * proTips.length);
    if (currentTipTypewriter) clearInterval(currentTipTypewriter);
    currentTipTypewriter = typewriterEffect(display, proTips[currentTipIndex], 15);
    
    display.style.transition = 'opacity 0.2s ease-in-out';

    const tipBox = display.closest('.quick-rules');
    if (tipBox) {
        tipBox.style.cursor = 'pointer';
        tipBox.title = 'Click for next tip';
        
        tipBox.onmouseenter = () => tipBox.style.background = 'rgba(255,255,255,0.05)';
        tipBox.onmouseleave = () => tipBox.style.background = 'rgba(0, 0, 0, 0.2)';
        
        tipBox.onclick = () => {
            playSound(sfx.click);
            currentTipIndex = (currentTipIndex + 1) % proTips.length;
            
            display.style.opacity = '0';
            setTimeout(() => {
                if (currentTipTypewriter) clearInterval(currentTipTypewriter);
                currentTipTypewriter = typewriterEffect(display, proTips[currentTipIndex], 15);
                display.style.opacity = '1';
            }, 200); 
        };
    }
}

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
            if (gameState.role === 'guest') return; 
            playSound(sfx.click);
            container.querySelectorAll('.genre-option').forEach(o => o.classList.remove('selected'));
            e.target.classList.add('selected');
            
            if (containerId === 'lobby-genre') {
                mySelectedGenre = g;
                if(socket) socket.emit('update-settings', gameState.roomId, mySelectedGenre, mySelectedDifficulty);
            } 
            else if (containerId === 'rematch-genre' || containerId === 'guest-rematch-genre') {
                let diffContainer = document.getElementById(gameState.role === 'host' ? 'rematch-difficulty' : 'guest-rematch-difficulty');
                let rDiff = diffContainer.querySelector('.selected').getAttribute('data-difficulty');
                if(socket) socket.emit('update-rematch-settings', gameState.roomId, g, rDiff);
            }
        };
        container.appendChild(btn);
    });

    return selGenreForRematch; 
}

// --- NETWORK EVENTS ---
socket = io('/');

socket.on('connect', () => {
    const overlay = document.getElementById('entry-overlay');
    
    const savedRoom = safeGetItem('duobrain_active_room');
    if (savedRoom) {
        gameState.roomId = savedRoom;
        socket.emit('reconnect-player', savedRoom, myPersistentId);
    }

    if (overlay && !overlay.classList.contains('hidden-element')) {
        const ping = Date.now() - connectionStartTime;
        const statusText = overlay.querySelector('p');
        
        if (statusText) {
            statusText.innerHTML = `Connected! <span style="color:white; font-size: 0.9rem;">(${ping}ms ping)</span>`;
            statusText.style.color = '#10b981'; 
            statusText.style.animation = 'none'; 
        }
        
        setTimeout(() => {
            overlay.classList.add('hidden-element');
            if (!safeGetItem('duobrain_name')) {
                profileOverlay.style.display = 'flex';
                profileOverlay.classList.remove('hidden-element');
            }
        }, 600); 
    }
});

socket.on('global-stats', (online, matches) => {
    const statOnline = document.getElementById('stat-online');
    const statMatches = document.getElementById('stat-matches');
    if(statOnline) statOnline.textContent = online;
    if(statMatches) statMatches.textContent = matches;
});

socket.on('pause-game', (playerName) => {
    isPaused = true;
    pausedRemainingMs = expectedEndTime - Date.now(); 
    
    const pauseModal = document.getElementById('pause-overlay');
    const pauseText = document.getElementById('pause-text');
    
    if (pauseModal && pauseText) {
        pauseCountdown = 30; // 30s UI grace period
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

// SENIOR DEV FIX: P2P State Recovery system. The player who stayed sends their state.
// Sync state is now server-authoritative

// SENIOR DEV FIX: Reconnecting player receives state and instantly rebuilds the UI
socket.on('recover-game', (data) => {
    gameState.roomId = data.roomId;
    gameState.genre = data.genre;
    gameState.questions = data.questions;
    gameState.currentQuestionIndex = data.currentIndex;
    gameState.myScore = data.myScore;
    gameState.enemyScore = data.enemyScore;
    gameState.myWager = data.myWager;
    gameState.enemyWager = data.enemyWager;

    document.getElementById('my-avatar-display').innerHTML = renderAvatar(data.avatarMe);
    document.getElementById('remote-avatar-display').innerHTML = renderAvatar(data.avatarThem);
    document.getElementById('remote-label').textContent = data.nameThem;

    document.getElementById('p1-score-display').textContent = `Me: ${gameState.myScore}`;
    document.getElementById('p2-score-display').textContent = `Opponent: ${gameState.enemyScore}`;

    document.getElementById('help-btn').style.display = 'none';
    document.querySelector('.chat-container').classList.remove('expanded-chat');
    
    const profileSetup = document.getElementById('profile-setup-overlay');
    if (profileSetup) profileSetup.classList.add('hidden-element');

    if (gameState.currentQuestionIndex === 4 && !gameState.myWager) {
        document.getElementById('wager-category').textContent = gameState.genre;
        switchScreen(screens.wager);
        document.querySelectorAll('.wager-btn').forEach(b => {
            b.disabled = false; b.style.opacity = '1';
        });
        const controls = document.getElementById('wager-controls');
        if (controls) { controls.style.opacity = '1'; controls.style.pointerEvents = 'auto'; }
        const waitText = document.getElementById('wager-wait-text');
        waitText.textContent = "Choose quickly! (Recovered)";
        waitText.style.color = "var(--primary-color)";
        waitText.classList.remove('hidden-element');
    } else {
        switchScreen(screens.quiz);
        renderQuestion();
    }
});


socket.on('default-win', () => {
    clearInterval(questionTimer);
    clearInterval(pauseTimerInterval); 
    isWaitingForOpponent = false;
    
    const pauseModal = document.getElementById('pause-overlay');
    if (pauseModal) pauseModal.classList.add('hidden-element');
    
    document.getElementById('powerups-ui').style.display = 'none';
    
    // Switch back to the quiz screen to show the victory panel
    switchScreen(screens.quiz);
    
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
        safeRemoveItem('duobrain_active_room');
        setTimeout(() => window.location.reload(), 150);
    };
    
    document.getElementById('turn-indicator').textContent = "Forfeit";
    document.querySelector('.chat-container').classList.add('expanded-chat');

    sfx.bgm.volume = 0.1;
    playSound(sfx.win);
    setTimeout(() => { sfx.bgm.volume = 0.3; }, 4000);
});

socket.on('room-created', id => { 
    gameState.role = 'host';
    gameState.roomId = id;
    safeSetItem('duobrain_active_room', id);
    document.getElementById('room-code-display').textContent = id; 
    switchScreen(screens.lobby); 
});

socket.on('room-joined', (id, hostGenre, hostDiff) => {
    gameState.roomId = id;
    gameState.role = 'guest';
    safeSetItem('duobrain_active_room', id);
    document.getElementById('room-code-display').textContent = id;
    
    document.getElementById('lobby-genre').style.pointerEvents = 'none';
    document.getElementById('lobby-genre').style.opacity = '0.6';
    document.getElementById('lobby-difficulty').style.pointerEvents = 'none';
    document.getElementById('lobby-difficulty').style.opacity = '0.6';

    document.querySelectorAll('#lobby-genre .genre-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-genre') === hostGenre) o.classList.add('selected');
    });
    document.querySelectorAll('#lobby-difficulty .genre-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-difficulty') === hostDiff) o.classList.add('selected');
    });

    document.getElementById('lobby-status-text').textContent = "Connected!";
    document.getElementById('lobby-status-text').style.color = "#10b981";
    document.getElementById('lobby-players-text').textContent = "2 / 2 Connected";
    document.getElementById('copy-link-btn').style.display = 'none';
    document.getElementById('guest-waiting-text').classList.remove('hidden-element');

    switchScreen(screens.lobby);
});

socket.on('player-joined', (guestName) => {
    showToast(`${guestName} joined the lobby!`);
    document.getElementById('lobby-status-text').textContent = "Opponent Found!";
    document.getElementById('lobby-status-text').style.color = "#10b981";
    document.getElementById('lobby-players-text').textContent = "2 / 2 Connected";
    document.getElementById('copy-link-btn').style.display = 'none';
    document.getElementById('start-game-btn').classList.remove('hidden-element');
});

socket.on('settings-updated', (genre, diff) => {
    document.querySelectorAll('#lobby-genre .genre-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-genre') === genre) o.classList.add('selected');
    });
    document.querySelectorAll('#lobby-difficulty .genre-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-difficulty') === diff) o.classList.add('selected');
    });
});

socket.on('rematch-settings-updated', (genre, diff) => {
    document.querySelectorAll('#guest-rematch-genre .genre-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-genre') === genre) o.classList.add('selected');
    });
    document.querySelectorAll('#guest-rematch-difficulty .genre-option').forEach(o => {
        o.classList.remove('selected');
        if(o.getAttribute('data-difficulty') === diff) o.classList.add('selected');
    });
});

socket.on('join-error', (errorMessage) => {
    showToast(errorMessage);
    playSound(sfx.lose);
});

socket.on('game-start-error', (errorMsg) => {
    showToast(errorMsg);
    const btn = document.getElementById('start-game-btn');
    if(btn) {
        btn.textContent = "Start Match";
        btn.disabled = false;
        btn.style.opacity = '1';
    }
});

socket.on('opponent-disconnected', () => {
    if (isMatchFinished) {
        showToast(`Opponent left the room.`);
        return; 
    }
    clearInterval(pauseTimerInterval); 
    showToast(`Opponent disconnected! Returning to menu...`);
    playSound(sfx.lose);
    safeRemoveItem('duobrain_active_room');
    setTimeout(() => window.location.reload(), 2500);
});

socket.on('game-start', (players, genre, roomId, sanitizedQuestions) => {
    resetPowerUps(); 
    isMatchFinished = false;
    document.getElementById('help-btn').style.display = 'none'; 
    document.querySelector('.chat-container').classList.remove('expanded-chat'); 
    
    updateBackground(false); 
    
    gameState.roomId = roomId; gameState.genre = genre; gameState.myPlayerId = socket.id; gameState.questions = sanitizedQuestions;
    const me = players.find(p => p.id === socket.id); const them = players.find(p => p.id !== socket.id);
    gameState.role = me.role;
    
    document.getElementById('my-avatar-display').innerHTML = renderAvatar(me.avatar);
    document.getElementById('remote-avatar-display').innerHTML = renderAvatar(them.avatar);
    document.getElementById('remote-label').textContent = them.name;
    
    startCountdownSequence();
});

socket.on('start-wager-phase', (genre) => {
    document.getElementById('wager-category').textContent = genre;
    const controls = document.getElementById('wager-controls');
    const waitText = document.getElementById('wager-wait-text');
    
    if (controls) {
        controls.style.opacity = '0.3';
        controls.style.pointerEvents = 'none';
    }
    
    document.querySelectorAll('.wager-btn').forEach(b => {
        b.disabled = false;
        b.style.opacity = '1';
    });
    
    gameState.myWager = null;
    switchScreen(screens.wager);

    let prepTime = 3;
    waitText.innerHTML = `<span style="color: #ef4444; font-size: 1.3rem; font-weight: 900; animation: pulse 0.5s infinite;">READ THE CATEGORY (${prepTime}s)</span>`;
    waitText.classList.remove('hidden-element');
    
    clearInterval(window.wagerInterval);
    
    window.wagerInterval = setInterval(() => {
        prepTime--;
        if (prepTime > 0) {
            waitText.innerHTML = `<span style="color: #ef4444; font-size: 1.3rem; font-weight: 900; animation: pulse 0.5s infinite;">READ THE CATEGORY (${prepTime}s)</span>`;
            playSound(sfx.tick); 
        } else {
            clearInterval(window.wagerInterval);
            if (controls) {
                controls.style.opacity = '1';
                controls.style.pointerEvents = 'auto';
            }
            
            let wTime = 10;
            waitText.innerHTML = `Choose quickly! (${wTime}s)`;
            waitText.style.color = "var(--primary-color)";
            playSound(sfx.notif); 
            
            window.wagerInterval = setInterval(() => {
                wTime--;
                if (!gameState.myWager) waitText.innerHTML = `Choose quickly! (${wTime}s)`;
                if (wTime <= 0) {
                    clearInterval(window.wagerInterval);
                    if (!gameState.myWager) {
                        document.querySelector('.wager-btn[data-wager="1"]').click(); 
                    }
                }
            }, 1000);
        }
    }, 1000);
});

socket.on('wager-phase-complete', (wagers) => {
    // SENIOR DEV FIX: Read wagers from persistent IDs
    gameState.myWager = wagers[myPersistentId];
    const enemyId = Object.keys(wagers).find(id => id !== myPersistentId);
    gameState.enemyWager = wagers[enemyId];
    
    const waitText = document.getElementById('wager-wait-text');
    waitText.textContent = "Points Locked! Prepare for battle...";
    waitText.style.color = "#10b981"; 
    waitText.classList.remove('hidden-element');
    playSound(sfx.win); 
});

socket.on('round-results', (answers, correctAns, serverScores) => {
    clearInterval(questionTimer);
    stopSound(sfx.tick); 
    isWaitingForOpponent = false;
    timerDisplay.classList.add('hidden-element');
    const tbc = document.getElementById('timer-bar-container');
    if (tbc) tbc.classList.add('hidden-element');
    optsContainer.classList.remove('options-grid'); 

    const q = gameState.questions[gameState.currentQuestionIndex];
    q.answer = correctAns; 

    // SENIOR DEV FIX: Read answers from persistent IDs to survive disconnects
    const myData = answers[myPersistentId];
    const enemyId = Object.keys(answers).find(id => id !== myPersistentId);
    const enemyData = answers[enemyId];
    
    if (!myData || !enemyData) return; // Failsafe check

    const myAns = myData.index;
    const enemyAns = enemyData.index;

    if (serverScores) {
        gameState.myScore = serverScores[myPersistentId] || 0;
        gameState.enemyScore = serverScores[enemyId] || 0;
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
        let wagerText = "";
        if (gameState.currentQuestionIndex === 4) {
            let myWagerMod = myAns === q.answer ? `+${gameState.myWager}` : `-${gameState.myWager}`;
            let enemyWagerMod = enemyAns === q.answer ? `+${gameState.enemyWager}` : `-${gameState.enemyWager}`;
            wagerText = `<p style="margin-top: 8px; font-size: 0.9rem; font-weight: bold; color: #f59e0b;">CLUTCH RESULTS: You ${myWagerMod} | Enemy ${enemyWagerMod}</p>`;
        }

        optsContainer.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); padding: 15px 20px; border-radius: 12px; text-align: left;">
                <p style="margin-bottom:6px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase;">Round Review</p>
                <p style="margin-bottom:6px; font-size: 1.05rem;">Answer: <strong style="color:var(--primary-color);">${q.options[q.answer]}</strong></p>
                <p style="margin-bottom:4px; font-size:0.95rem;">You: ${myAns === -1 ? 'Timeout' : q.options[myAns]} <span class="${myAns === q.answer ? 'text-correct' : 'text-incorrect'}">${myAns === q.answer ? '(Correct)' : '(Incorrect)'}</span></p>
                <p style="font-size:0.95rem;">Enemy: ${enemyAns === -1 ? 'Timeout' : q.options[enemyAns]} <span class="${enemyAns === q.answer ? 'text-correct' : 'text-incorrect'}">${enemyAns === q.answer ? '(Correct)' : '(Incorrect)'}</span></p>
                ${wagerText}
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
        isMatchFinished = true;
        if (socket) socket.emit('match-finished', gameState.roomId);
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

        optsContainer.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); padding: 15px; border-radius: 12px; text-align: center; margin-bottom: 10px;">
                <p style="margin-bottom:8px; font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; font-weight: 800; letter-spacing: 1px;">Match Summary</p>
                <p style="font-size: 1.2rem; font-weight: 800; margin-bottom: 5px;">Final Score: <span style="color: var(--primary-color);">${gameState.myScore} - ${gameState.enemyScore}</span></p>
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
                const p = document.createElement('div'); p.className = 'genre-option'; p.textContent = d.text;
                p.setAttribute('data-difficulty', d.id);
                p.onclick = (e) => {
                    playSound(sfx.click);
                    rdiff.querySelectorAll('.genre-option').forEach(o => o.classList.remove('selected'));
                    e.target.classList.add('selected'); selDiff = d.id;
                    const activeGenreBtn = document.querySelector('#rematch-genre .genre-option.selected');
                    const finalGenre = activeGenreBtn ? activeGenreBtn.getAttribute('data-genre') : selGenre;
                    socket.emit('update-rematch-settings', gameState.roomId, finalGenre, selDiff);
                };
                if(d.id === gameState.difficulty) { p.classList.add('selected'); selDiff = d.id; } 
                else if (!gameState.difficulty && d.id === 'any') { p.classList.add('selected'); }
                rdiff.appendChild(p);
            });
            document.getElementById('rematch-btn').onclick = (e) => {
                playSound(sfx.click);
                e.target.disabled = true;
                e.target.textContent = "Loading...";
                const activeGenreBtn = document.querySelector('#rematch-genre .genre-option.selected');
                const finalGenre = activeGenreBtn ? activeGenreBtn.getAttribute('data-genre') : selGenre;
                socket.emit('play-again', gameState.roomId, finalGenre, selDiff);
            };
            document.getElementById('back-menu-btn').onclick = () => {
                playSound(sfx.click);
                safeRemoveItem('duobrain_active_room');
                setTimeout(() => window.location.reload(), 150);
            };
        } else {
            const waitingBox = document.createElement('div');
            waitingBox.className = 'rematch-box'; 
            waitingBox.innerHTML = `
                <h3 style="margin-bottom: 15px; color: var(--primary-color);">Host is setting up...</h3>
                <div class="genre-selector" id="guest-rematch-genre" style="margin-bottom: 10px; pointer-events: none; opacity: 0.6;"></div>
                <h4 style="margin: 10px 0 10px; color: var(--text-muted); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 1px; text-align: left; font-weight: 800;">Difficulty</h4>
                <div class="genre-selector" id="guest-rematch-difficulty" style="grid-template-columns: repeat(4, 1fr); margin-bottom: 15px; pointer-events: none; opacity: 0.6;"></div>
                <button id="back-menu-btn-guest" class="secondary-btn" style="margin-top: 15px;">Leave to Main Menu</button>
            `;
            optsContainer.appendChild(waitingBox);
            injectDailyGenres('guest-rematch-genre', true);
            const rdiff = document.getElementById('guest-rematch-difficulty');
            [ {id: 'any', text: 'Any'}, {id: 'easy', text: 'Easy'}, {id: 'medium', text: 'Med'}, {id: 'hard', text: 'Hard'} ].forEach(d => {
                const p = document.createElement('div'); p.className = 'genre-option'; p.textContent = d.text;
                p.setAttribute('data-difficulty', d.id);
                if(d.id === gameState.difficulty) p.classList.add('selected');
                else if (!gameState.difficulty && d.id === 'any') p.classList.add('selected');
                rdiff.appendChild(p);
            });
            document.getElementById('back-menu-btn-guest').onclick = () => {
                playSound(sfx.click);
                safeRemoveItem('duobrain_active_room');
                setTimeout(() => window.location.reload(), 150);
            };
        }
    }
});

function startCountdownSequence() {
    clearInterval(countdownTimer); 
    switchScreen(screens.countdown);
    let count = 3;
    const countText = document.getElementById('countdown-text');
    countText.textContent = count;
    countText.classList.add('countdown-pulse');
    playSound(sfx.tick);
    countdownTimer = setInterval(() => {
        count--;
        if (count > 0) { countText.textContent = count; playSound(sfx.tick); } 
        else {
            clearInterval(countdownTimer);
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
        updateBackground(true);
    } else if (gameState.currentQuestionIndex === 4) {
        document.getElementById('turn-indicator').innerHTML = `<span style="color:#f59e0b; font-weight:900;">CLUTCH ROUND</span>`;
        updateBackground(false);
    } else {
        document.getElementById('turn-indicator').textContent = `Round ${gameState.currentQuestionIndex + 1}`;
        updateBackground(false);
    }
    
    optsContainer.innerHTML = '';
    timerDisplay.classList.remove('hidden-element');
    
    const timerBarContainer = document.getElementById('timer-bar-container');
    const timerBar = document.getElementById('timer-bar');
    if (timerBarContainer) timerBarContainer.classList.remove('hidden-element');
    if (timerBar) {
        timerBar.style.width = '100%';
        timerBar.style.backgroundColor = '#10b981';
    }
    
    timerDisplay.textContent = `${timeLeft}s`;
    clearInterval(questionTimer);
    questionTimer = setInterval(() => {
        if (isPaused) return;
        const remainingMs = expectedEndTime - Date.now();
        timeLeft = Math.ceil(remainingMs / 1000);
        
        if (timerBar) {
            let percentage = Math.max(0, (remainingMs / (durationSec * 1000)) * 100);
            timerBar.style.width = `${percentage}%`;
            if (percentage <= 20) timerBar.style.backgroundColor = '#ef4444';
            else if (percentage <= 50) timerBar.style.backgroundColor = '#f59e0b';
            else timerBar.style.backgroundColor = '#10b981';
        }
        
        if (timeLeft <= 0) {
            timeLeft = 0; timerDisplay.textContent = `0s`; clearInterval(questionTimer); stopSound(sfx.tick); 
            isWaitingForOpponent = true;
            if(socket) socket.emit('submit-answer', gameState.roomId, -1, 0, myPersistentId);
            optsContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 25px; background: rgba(239, 68, 68, 0.1); border-radius: 16px; border: 2px dashed #ef4444;"><h3 style="color: #ef4444; margin-bottom: 10px; font-size: 1.5rem; text-shadow: 0 0 15px #ef4444;">Time's Up!</h3><p style="color: white; font-size: 1rem; font-weight: 700; animation: pulse 1.5s infinite;">Waiting for opponent...</p></div>`;
            return;
        }
        timerDisplay.textContent = `${timeLeft}s`;
        if (timeLeft <= 5 && timeLeft > 0) {
            timerDisplay.classList.add('timer-warning'); 
            if (tickSoundPlayedForSecond !== timeLeft) { playSound(sfx.tick); tickSoundPlayedForSecond = timeLeft; }
        } else { timerDisplay.classList.remove('timer-warning'); }
    }, 100);

    currentQ.options.forEach((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'option-btn'; btn.textContent = opt;
        btn.onclick = () => {
            playSound(sfx.click); clearInterval(questionTimer); stopSound(sfx.tick); 
            isWaitingForOpponent = true;
            if(socket) socket.emit('submit-answer', gameState.roomId, i, timeLeft, myPersistentId);
            optsContainer.innerHTML = `<div style="grid-column: 1 / -1; text-align: center; padding: 25px; background: rgba(56, 189, 248, 0.1); border-radius: 16px; border: 2px dashed #38bdf8;"><h3 style="color: #38bdf8; margin-bottom: 10px; font-size: 1.5rem; text-shadow: 0 0 15px #38bdf8;">Answer Locked</h3><p style="color: white; font-size: 1rem; font-weight: 700; animation: pulse 1.5s infinite;">Waiting for opponent...</p></div>`;
        };
        optsContainer.appendChild(btn);
    });
}

socket.on('load-next-question', () => { switchScreen(screens.quiz); gameState.currentQuestionIndex++; renderQuestion(); });

socket.on('restart-game', (g, sanitizedQuestions) => { 
    clearInterval(pauseTimerInterval); resetPowerUps(); isMatchFinished = false; isWaitingForOpponent = false;
    document.getElementById('help-btn').style.display = 'none';
    document.querySelector('.chat-container').classList.remove('expanded-chat'); 
    updateBackground(false);
    gameState.genre = g; gameState.questions = sanitizedQuestions;
    gameState.currentQuestionIndex = 0; gameState.myScore = 0; gameState.enemyScore = 0; 
    gameState.myWager = null; gameState.enemyWager = null;
    startCountdownSequence();
});

socket.on('enemy-powerup', (type, enemyName) => {
    if(type === '5050') showToast(`<strong>${enemyName}</strong> used Decrypt!`);
    if(type === 'freeze') {
        showToast(`<strong>${enemyName}</strong> overclocked their timer!`);
        timerDisplay.classList.remove('ice-flash'); void timerDisplay.offsetWidth; timerDisplay.classList.add('ice-flash');
    }
    if(type === 'jammer') {
        showToast(`<strong>${enemyName}</strong> glitched your screen!`);
        optsContainer.classList.add('jammed-state');
        const vig = document.getElementById('jammer-vignette');
        vig.classList.add('vignette-active');
        setTimeout(() => { optsContainer.classList.remove('jammed-state'); vig.classList.remove('vignette-active'); }, 5000); 
    }
});

socket.on('receive-chat', d => { playSound(sfx.notif); addMsg(d.name, d.text, false); });

// --- INITIALIZATION ---
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
    
    initProfile();
    setHourlyFunFact();
    initProTips(); 
    injectDailyGenres('lobby-genre');
});

const screens = { 
    menu: document.getElementById('menu-screen'), 
    lobby: document.getElementById('lobby-screen'), 
    countdown: document.getElementById('countdown-screen'),
    wager: document.getElementById('wager-screen'), 
    quiz: document.getElementById('quiz-screen') 
};
const timerDisplay = document.getElementById('timer-display');
const optsContainer = document.getElementById('options-container');

function switchScreen(screenToActivate) {
    Object.values(screens).forEach(s => s.classList.replace('active-screen', 'hidden-screen'));
    screenToActivate.classList.replace('hidden-screen', 'active-screen');
}

const rulesModal = document.getElementById('rules-modal');
document.getElementById('help-btn').onclick = () => { playSound(sfx.click); rulesModal.classList.remove('hidden-element'); };
document.getElementById('close-rules-btn').onclick = () => { playSound(sfx.click); rulesModal.classList.add('hidden-element'); };

function resetPowerUps() {
    powerUps = { fifty: false, freeze: false, jammer: false };
    document.querySelectorAll('.pu-btn').forEach(btn => btn.classList.remove('used'));
    document.getElementById('powerups-ui').style.display = 'flex';
}

document.getElementById('pu-5050').onclick = function() {
    if (powerUps.fifty || gameState.currentQuestionIndex >= 6) return;
    powerUps.fifty = true; this.classList.add('used'); playSound(sfx.click); playDecryptSound();
    showToast("You activated Decrypt!");
    if(socket) socket.emit('trigger-powerup', gameState.roomId, '5050', gameState.myName);
    const q = gameState.questions[gameState.currentQuestionIndex];
    const buttons = document.querySelectorAll('.option-btn');
    q.removableIndices.forEach(idx => {
        if (idx !== undefined && buttons[idx] && !buttons[idx].disabled) {
            buttons[idx].classList.add('decrypt-glitch-out');
            buttons[idx].disabled = true;
        }
    });
    document.body.classList.add('decrypt-screen-flash');
    setTimeout(() => document.body.classList.remove('decrypt-screen-flash'), 500);
};

document.getElementById('pu-freeze').onclick = function() {
    if (powerUps.freeze || gameState.currentQuestionIndex >= 6) return;
    powerUps.freeze = true; this.classList.add('used'); playSound(sfx.click); playOverclockSound();
    showToast("You activated Overclock!");
    if(socket) socket.emit('trigger-powerup', gameState.roomId, 'freeze', gameState.myName);
    expectedEndTime += 8000; 
    timerDisplay.textContent = `${Math.ceil((expectedEndTime - Date.now())/1000)}s`;
    timerDisplay.classList.add('overclock-active');
    document.body.classList.add('overclock-screen-flash');
    setTimeout(() => {
        timerDisplay.classList.remove('overclock-active');
        document.body.classList.remove('overclock-screen-flash');
        timerDisplay.classList.add('frozen-text');
    }, 1000);
};

document.getElementById('pu-jammer').onclick = function() {
    if (powerUps.jammer || gameState.currentQuestionIndex >= 6) return;
    powerUps.jammer = true; this.classList.add('used'); playSound(sfx.click); playGlitchSound();
    showToast("You glitched their screen!");
    if(socket) socket.emit('trigger-powerup', gameState.roomId, 'jammer', gameState.myName);
};

document.querySelectorAll('.wager-btn').forEach(btn => {
    btn.onclick = (e) => {
        if (gameState.myWager) return; 
        playSound(sfx.click);
        const amount = parseInt(e.target.getAttribute('data-wager'));
        gameState.myWager = amount;
        document.querySelectorAll('.wager-btn').forEach(b => {
            b.disabled = true; if(b !== e.target) b.style.opacity = '0.3';
        });
        const waitText = document.getElementById('wager-wait-text');
        waitText.textContent = "Waiting for opponent to lock in...";
        waitText.classList.remove('hidden-element');
        if(socket) socket.emit('submit-wager', gameState.roomId, amount, myPersistentId);
    };
});

document.querySelectorAll('#lobby-difficulty .genre-option').forEach(option => {
    option.onclick = (e) => {
        if (gameState.role === 'guest') return;
        playSound(sfx.click);
        document.querySelectorAll('#lobby-difficulty .genre-option').forEach(opt => opt.classList.remove('selected'));
        e.target.classList.add('selected');
        mySelectedDifficulty = e.target.getAttribute('data-difficulty');
        if(socket) socket.emit('update-settings', gameState.roomId, mySelectedGenre, mySelectedDifficulty);
    };
});

document.getElementById('create-btn').onclick = () => {
    playSound(sfx.click);
    const btn = document.getElementById('create-btn');
    btn.textContent = "Creating..."; btn.disabled = true; btn.style.opacity = '0.7';
    if(socket) socket.emit('create-room', mySelectedAvatar, gameState.myName, mySelectedGenre, mySelectedDifficulty, myPersistentId);
    
    setTimeout(() => {
        btn.textContent = "Create Room"; btn.disabled = false; btn.style.opacity = '1';
    }, 2000);
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
    const c = document.getElementById('room-input').value;
    if(!c) return;
    if(socket) socket.emit('join-room', c.toUpperCase(), mySelectedAvatar, gameState.myName, myPersistentId);
};

document.getElementById('start-game-btn').onclick = () => {
    playSound(sfx.click);
    const btn = document.getElementById('start-game-btn');
    btn.textContent = "Loading..."; btn.disabled = true; btn.style.opacity = '0.7';
    if(socket) socket.emit('start-game', gameState.roomId);
};

// --- EMOJI PICKER (IN-GAME CHAT ONLY) ---
const emojiBtn = document.getElementById('emoji-btn');
const emojiPicker = document.getElementById('emoji-picker');
const chatIn = document.getElementById('chat-input');
const emojiList = ['😀','😂','🤣','😊','😍','😭','🥺','😎','🔥','👍','❤️','✨','💀','💯','🤔','🙌','👀','🤯','🎉','💪'];

if (emojiBtn && emojiPicker) {
    emojiList.forEach(emoji => {
        const span = document.createElement('span');
        span.className = 'emoji-item'; span.textContent = emoji;
        span.setAttribute('role', 'button'); span.setAttribute('tabindex', '0');
        span.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); span.click(); } };
        span.onclick = () => { chatIn.value += emoji; chatIn.focus(); };
        emojiPicker.appendChild(span);
    });

    emojiBtn.onclick = (e) => { e.stopPropagation(); emojiPicker.classList.toggle('hidden-element'); };
    document.addEventListener('click', (e) => { if (!emojiPicker.contains(e.target) && e.target !== emojiBtn) emojiPicker.classList.add('hidden-element'); });
}

// --- CHAT SYSTEM ---
function addMsg(n, t, me) {
    const chatMsgs = document.getElementById('chat-messages');
    const d = document.createElement('div'); d.className = `chat-bubble ${me ? 'me' : 'them'}`;
    d.innerHTML = `<strong>${n}:</strong> `; d.appendChild(document.createTextNode(t));
    chatMsgs.appendChild(d); chatMsgs.scrollTop = chatMsgs.scrollHeight;
}

document.getElementById('send-chat-btn').onclick = () => {
    playSound(sfx.notif); 
    const t = chatIn.value.trim(); if(!t) return;
    if(socket) socket.emit('send-chat', gameState.roomId, { name: gameState.myName, text: t });
    addMsg("You", t, true); chatIn.value = "";
};
document.getElementById('chat-input').onkeypress = (e) => { if(e.key === 'Enter') document.getElementById('send-chat-btn').click(); };

// --- SMART MOBILE SCROLLING ---
if (chatIn) {
    chatIn.addEventListener('focus', () => {
        setTimeout(() => {
            chatIn.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
    });
}

// --- TYPEWRITER EFFECT ---
function typewriterEffect(element, text, speed = 15) {
    element.innerHTML = '';
    let i = 0;
    const interval = setInterval(() => {
        if (i < text.length) {
            element.innerHTML += text.charAt(i);
            i++;
        } else {
            clearInterval(interval);
        }
    }, speed);
    return interval;
}
