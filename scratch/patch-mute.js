const fs = require('fs');
let code = fs.readFileSync('public/script.js', 'utf8');

const target = `if (muteBtn) {
    muteBtn.onclick = (e) => {
        isGlobalMuted = !isGlobalMuted;
        e.target.textContent = isGlobalMuted ? '🔇' : '🔊';
        masterGain.gain.value = isGlobalMuted ? 0 : 1;
    };
}`;

const replacement = `if (muteBtn) {
    muteBtn.onclick = (e) => {
        isGlobalMuted = !isGlobalMuted;
        const iconOn = \`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary-color)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path></svg>\`;
        const iconOff = \`<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>\`;
        muteBtn.innerHTML = isGlobalMuted ? iconOff : iconOn;
        masterGain.gain.value = isGlobalMuted ? 0 : 1;
    };
}`;

code = code.replace(target.replace(/\n/g, '\r\n'), replacement);
code = code.replace(target, replacement);

fs.writeFileSync('public/script.js', code);
console.log("Fixed script.js mute button");
