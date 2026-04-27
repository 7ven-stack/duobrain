const fs = require('fs');
let code = fs.readFileSync('public/script.js', 'utf8');

const audioFunctions = `
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
`;

if (!code.includes('function playDecryptSound')) {
    code = code.replace(/let bgmStarted = false;/, audioFunctions + '\nlet bgmStarted = false;');
}

const decryptTarget = `powerUps.fifty = true; this.classList.add('used'); playSound(sfx.click);`;
const overclockTarget = `powerUps.freeze = true; this.classList.add('used'); playSound(sfx.click);`;
const glitchTarget = `powerUps.jammer = true; this.classList.add('used'); playSound(sfx.click);`;

code = code.replace(decryptTarget, `powerUps.fifty = true; this.classList.add('used'); playSound(sfx.click); playDecryptSound();`);
code = code.replace(overclockTarget, `powerUps.freeze = true; this.classList.add('used'); playSound(sfx.click); playOverclockSound();`);
code = code.replace(glitchTarget, `powerUps.jammer = true; this.classList.add('used'); playSound(sfx.click); playGlitchSound();`);

fs.writeFileSync('public/script.js', code);
console.log('Audio patch complete.');
