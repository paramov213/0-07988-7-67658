const CONFIG = { ADM_L: "xeone", ADM_P: "565811" };
let peer, conn, myId, typingTimeout;
let isPremium = localStorage.getItem('broke_prem') === 'true';

// Инициализация звука
const playSound = (freq = 440) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.1, ctx.currentTime);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.1);
    osc.stop(ctx.currentTime + 0.1);
};

document.addEventListener('DOMContentLoaded', () => {
    initEvents();
    if(localStorage.getItem('broke_id')) startPeer(localStorage.getItem('broke_id'));
});

function initEvents() {
    // Вход/Рега
    document.getElementById('btn-reg-view').onclick = () => {
        document.getElementById('auth-options').classList.add('hidden');
        document.getElementById('reg-section').classList.remove('hidden');
    };
    document.getElementById('btn-login-view').onclick = () => {
        document.getElementById('auth-options').classList.add('hidden');
        document.getElementById('login-section').classList.remove('hidden');
    };
    document.getElementById('btn-finish-reg').onclick = () => {
        localStorage.setItem('broke_user_name', document.getElementById('reg-name').value || "User");
        startPeer(null);
    };
    document.getElementById('btn-finish-login').onclick = () => {
        const id = document.getElementById('login-id-input').value;
        if(id) startPeer(id);
    };

    // Админка
    document.getElementById('status-badge').onclick = () => document.getElementById('admin-modal').classList.remove('hidden');
    document.getElementById('btn-adm-cancel').onclick = () => document.getElementById('admin-modal').classList.add('hidden');
    document.getElementById('btn-adm-auth').onclick = () => {
        if(document.getElementById('adm-l').value === CONFIG.ADM_L && document.getElementById('adm-p').value === CONFIG.ADM_P) {
            document.body.classList.add('admin-active');
            document.getElementById('admin-tools').classList.remove('hidden');
            document.getElementById('status-badge').innerText = "ADMIN";
            document.getElementById('admin-modal').classList.add('hidden');
            playSound(880);
        }
    };

    // Чат
    document.getElementById('btn-connect-peer').onclick = () => {
        const tid = document.getElementById('connect-to-id').value;
        if(tid) { conn = peer.connect(tid); setupConn(); }
    };

    document.getElementById('btn-send').onclick = sendMsg;
    
    // Typing...
    document.getElementById('msg-input').oninput = () => {
        if(conn) conn.send({ type: 'TYPING' });
    };

    document.getElementById('user-id-display').onclick = () => {
        navigator.clipboard.writeText(myId);
        alert("ID Скопирован!");
    };

    document.getElementById('btn-logout').onclick = () => {
        localStorage.removeItem('broke_id');
        location.reload();
    };
}

function startPeer(id) {
    peer = new Peer(id);
    peer.on('open', (newId) => {
        myId = newId;
        localStorage.setItem('broke_id', newId);
        document.getElementById('user-id-display').innerText = "ID: " + newId;
        document.getElementById('user-name-display').innerText = localStorage.getItem('broke_user_name') || "User";
        document.getElementById('auth-modal').classList.add('hidden');
        document.getElementById('app').classList.remove('hidden');
    });

    peer.on('connection', (c) => {
        conn = c;
        setupConn();
    });
}

function setupConn() {
    document.getElementById('chat-target-name').innerText = "В сети: " + conn.peer;
    playSound(660);

    conn.on('data', (data) => {
        if(data.type === 'TYPING') {
            document.getElementById('typing-indicator').classList.remove('hidden');
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => document.getElementById('typing-indicator').classList.add('hidden'), 2000);
            return;
        }
        if(data.type === 'DELIVERED') {
            const lastMsgStatus = document.querySelector('.sent:last-child .status-info');
            if(lastMsgStatus) lastMsgStatus.innerText = "✓ Прочитано";
            return;
        }
        if(data.text) {
            renderMsg(data.text, 'recv');
            playSound(440);
            conn.send({ type: 'DELIVERED' });
        }
    });
}

function sendMsg() {
    const input = document.getElementById('msg-input');
    if(conn && input.value) {
        conn.send({ text: input.value });
        renderMsg(input.value, 'sent');
        input.value = "";
    }
}

function renderMsg(t, type) {
    const box = document.getElementById('msg-box');
    const m = document.createElement('div');
    m.className = `m ${type}`;
    m.innerHTML = `${t} <span class="status-info">${type === 'sent' ? '✓' : ''}</span>`;
    box.appendChild(m);
    box.scrollTop = box.scrollHeight;
}
