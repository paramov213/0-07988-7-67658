const ADMIN_ID = "xeone";
const db = new Dexie("BrokeDB");
db.version(1).stores({ messages: '++id, chatId, sender, text, timestamp' });

let peer = null;
let currentConn = null;
let myStream = null;
let activeChatId = null;
let connections = {};

// ПРОВЕРКА ВЕЧНОГО БАНА
if (localStorage.getItem('broke_banned') === 'true') {
    document.getElementById('ban-screen').classList.remove('hidden');
    throw new Error("Device is banned");
}

function initPeer(id) {
    peer = new Peer(id, {
        debug: 1,
        config: {'iceServers': [{ 'urls': 'stun:stun.l.google.com:19302' }]}
    });

    peer.on('open', (openedId) => {
        document.getElementById('auth-screen').classList.add('hidden');
        document.getElementById('main-app').classList.remove('hidden');
        document.getElementById('my-id-display').innerText = `ID: ${openedId}`;

        if (openedId === ADMIN_ID) {
            document.getElementById('admin-panel').classList.remove('hidden');
            document.getElementById('admin-badge').classList.remove('hidden');
            document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hidden'));
        }
        startHeartbeat();
    });

    peer.on('connection', (conn) => {
        connections[conn.peer] = conn;
        setupConn(conn);
        addContact(conn.peer);
    });

    peer.on('call', (call) => {
        document.getElementById('call-modal').classList.remove('hidden');
        document.getElementById('caller-name').innerText = call.peer;
        document.getElementById('call-accept').onclick = async () => {
            myStream = await navigator.mediaDevices.getUserMedia({video: true, audio: true});
            document.getElementById('local-video').srcObject = myStream;
            call.answer(myStream);
            handleCall(call);
            document.getElementById('call-modal').classList.add('hidden');
        };
    });
}

function setupConn(conn) {
    conn.on('data', (data) => {
        // КОМАНДЫ АДМИНИСТРАТОРА
        if (data.type === 'SYS') {
            if (data.cmd === 'BAN') {
                localStorage.setItem('broke_banned', 'true');
                location.reload();
            }
            if (data.cmd === 'LOCK') {
                document.getElementById('main-app').classList.add('hidden');
                document.getElementById('maintenance-screen').classList.remove('hidden');
                document.getElementById('lock-reason').innerText = data.text;
            }
            if (data.cmd === 'UNLOCK') {
                document.getElementById('main-app').classList.remove('hidden');
                document.getElementById('maintenance-screen').classList.add('hidden');
            }
            if (data.cmd === 'PURGE') {
                db.messages.clear();
                location.reload();
            }
            return;
        }

        if (data.type === 'msg') {
            saveAndRender(conn.peer, data.text, 'received');
        }
    });
}

// АДМИН-ФУНКЦИИ
const broadcast = (data) => Object.values(connections).forEach(c => c.open && c.send(data));

document.getElementById('btn-lock-all').onclick = () => 
    broadcast({type: 'SYS', cmd: 'LOCK', text: 'Технические работы. Доступ ограничен.'});

document.getElementById('btn-unlock-all').onclick = () => 
    broadcast({type: 'SYS', cmd: 'UNLOCK'});

document.getElementById('btn-purge-chat').onclick = () => {
    if(confirm("Очистить историю у всех?")) broadcast({type: 'SYS', cmd: 'PURGE'});
};

document.getElementById('btn-ban-peer').onclick = () => {
    if(activeChatId && connections[activeChatId]) {
        connections[activeChatId].send({type: 'SYS', cmd: 'BAN'});
        alert(`Пользователь ${activeChatId} забанен навсегда.`);
    }
};

// БАЗОВАЯ ЛОГИКА
async function saveAndRender(chatId, text, type) {
    const m = { chatId, sender: type === 'sent' ? 'me' : chatId, text, timestamp: Date.now() };
    await db.messages.add(m);
    if (activeChatId === chatId) {
        const d = document.createElement('div');
        d.className = `msg ${m.sender === 'me' ? 'sent' : 'received'}`;
        d.innerText = m.text;
        document.getElementById('messages-container').appendChild(d);
        document.getElementById('messages-container').scrollTop = 99999;
    }
}

function addContact(id) {
    if (document.getElementById(`c-${id}`)) return;
    const div = document.createElement('div');
    div.id = `c-${id}`;
    div.className = 'contact-item glass';
    div.innerHTML = `<span>${id}</span>`;
    div.onclick = () => {
        activeChatId = id;
        document.getElementById('chat-with-title').innerText = id;
        document.getElementById('messages-container').innerHTML = '';
        db.messages.where('chatId').equals(id).each(msg => {
            const d = document.createElement('div');
            d.className = `msg ${msg.sender === 'me' ? 'sent' : 'received'}`;
            d.innerText = msg.text;
            document.getElementById('messages-container').appendChild(d);
        });
        if(!connections[id]) {
            const c = peer.connect(id);
            connections[id] = c;
            setupConn(c);
        }
        document.getElementById('message-input').disabled = false;
        document.getElementById('send-btn').disabled = false;
        document.getElementById('top-controls').classList.remove('hidden');
    };
    document.getElementById('contacts-list').appendChild(div);
}

function startHeartbeat() {
    setInterval(() => peer && peer.socket.send({type:'HEARTBEAT'}), 15000);
}

document.getElementById('login-btn').onclick = () => {
    const nick = document.getElementById('username-input').value.trim();
    if(nick) initPeer(nick);
};

document.getElementById('send-btn').onclick = () => {
    const el = document.getElementById('message-input');
    if(el.value && connections[activeChatId]) {
        connections[activeChatId].send({type: 'msg', text: el.value});
        saveAndRender(activeChatId, el.value, 'sent');
        el.value = '';
    }
};

document.getElementById('add-chat-btn').onclick = () => {
    const id = document.getElementById('target-id-input').value.trim();
    if(id) { addContact(id); }
};

lucide.createIcons();