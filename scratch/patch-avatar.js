const fs = require('fs');
let code = fs.readFileSync('public/script.js', 'utf8');

if (!code.includes('function renderAvatar')) {
    const renderFunc = `
function renderAvatar(avatarData) {
    if (!avatarData) return '??';
    if (avatarData.startsWith('data:image/')) {
        return \`<img src="\${avatarData}" class="custom-avatar-img">\`;
    }
    return avatarData;
}
`;
    code = code.replace(/function updateMiniProfileDisplay/, renderFunc + '\nfunction updateMiniProfileDisplay');
}

code = code.replace(/<span class="cyber-avatar"[^>]*>\$\{mySelectedAvatar\}<\/span>/, '<span class="cyber-avatar" style="font-size:1.2rem;">${renderAvatar(mySelectedAvatar)}</span>');

const oldSelector = `document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(opt => {
    opt.onclick = (e) => {
        playSound(sfx.click);
        document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(o => o.classList.remove('selected'));
        e.target.classList.add('selected');
        mySelectedAvatar = e.target.getAttribute('data-avatar');
    };
});`;

const newSelector = `document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(opt => {
    opt.onclick = (e) => {
        if (e.target.id === 'custom-avatar-btn' || e.target.closest('#custom-avatar-btn')) return;
        playSound(sfx.click);
        document.querySelectorAll('#setup-avatar-selector .avatar-option').forEach(o => o.classList.remove('selected'));
        e.target.classList.add('selected');
        mySelectedAvatar = e.target.getAttribute('data-avatar');
    };
});`;

code = code.replace(oldSelector, newSelector);

const uploadLogic = `
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
}
`;
if (!code.includes('customAvatarInput.onchange')) {
    code = code.replace(newSelector, newSelector + '\n' + uploadLogic);
}

const oldMenuProfileClick = `        if (o.getAttribute('data-avatar') === mySelectedAvatar) o.classList.add('selected');`;
const newMenuProfileClick = `        if (o.getAttribute('data-avatar') === mySelectedAvatar) {
            o.classList.add('selected');
        }
        if (mySelectedAvatar && mySelectedAvatar.startsWith('data:image/') && o.id === 'custom-avatar-btn') {
            o.classList.add('selected');
            o.innerHTML = \`<img src="\${mySelectedAvatar}" class="custom-avatar-img">\`;
        }`;
code = code.replace(oldMenuProfileClick, newMenuProfileClick);

code = code.replace(/document\.getElementById\('my-avatar-display'\)\.textContent\s*=\s*data\.avatarMe;/g, "document.getElementById('my-avatar-display').innerHTML = renderAvatar(data.avatarMe);");
code = code.replace(/document\.getElementById\('remote-avatar-display'\)\.textContent\s*=\s*data\.avatarThem;/g, "document.getElementById('remote-avatar-display').innerHTML = renderAvatar(data.avatarThem);");

code = code.replace(/document\.getElementById\('my-avatar-display'\)\.textContent\s*=\s*me\.avatar;/g, "document.getElementById('my-avatar-display').innerHTML = renderAvatar(me.avatar);");
code = code.replace(/document\.getElementById\('remote-avatar-display'\)\.textContent\s*=\s*them\.avatar;/g, "document.getElementById('remote-avatar-display').innerHTML = renderAvatar(them.avatar);");

fs.writeFileSync('public/script.js', code);
console.log('Patched script.js');
