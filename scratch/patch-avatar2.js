const fs = require('fs');
let code = fs.readFileSync('public/script.js', 'utf8');

const oldCode = `document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(opt => {
    opt.onclick = (e) => {
        playSound(sfx.click);
        document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(o => o.classList.remove('selected'));
        e.target.classList.add('selected');
        mySelectedAvatar = e.target.getAttribute('data-avatar');
    };
});`;

const newCode = `document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(opt => {
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
                customAvatarBtn.innerHTML = \`<img src="\${compressedBase64}" class="custom-avatar-img">\`;
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    };
}`;

// Normalize newlines
code = code.replace(oldCode.replace(/\n/g, '\r\n'), newCode);
code = code.replace(oldCode, newCode);

fs.writeFileSync('public/script.js', code);
console.log('Patch complete.');
