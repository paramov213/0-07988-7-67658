const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { 
    maxHttpBufferSize: 1e8, 
    cors: { origin: "*" } 
});
const fs = require('fs').promises;
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');
let db = { users: {}, profiles: {}, economy: {}, messages: {}, system: { admin: "shict" } };

async function initDB() {
    try {
        const data = await fs.readFile(DB_FILE, 'utf8');
        db = JSON.parse(data);
    } catch (e) { await saveDB(); }
}

async function saveDB() {
    try { await fs.writeFile(DB_FILE, JSON.stringify(db, null, 4)); } catch (e) {}
}

initDB();
const sessions = {}; 

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    socket.on('auth', async (data) => {
        const u = data.login.trim().toLowerCase();
        if (data.type === 'reg') {
            if (db.users[u]) return socket.emit('err', 'Логин занят');
            db.users[u] = data.password;
            db.profiles[u] = { 
                nick: data.login, 
                ava: `https://api.dicebear.com/7.x/identicon/svg?seed=${u}`, 
                ls: "Online",
                coins: 50
            };
            await saveDB();
        }
        if (db.users[u] !== data.password) return socket.emit('err', 'Ошибка');
        socket.un = u;
        sessions[u] = socket.id;
        db.profiles[u].ls = "Online";
        socket.emit('auth_ok', { un: u, prof: db.profiles[u] });
    });

    socket.on('search_user', (q) => {
        const query = q.trim().toLowerCase();
        const res = Object.keys(db.profiles)
            .filter(l => l.includes(query) || db.profiles[l].nick.toLowerCase().includes(query))
            .map(l => ({ login: l, nick: db.profiles[l].nick, ava: db.profiles[l].ava }))
            .slice(0, 10);
        socket.emit('search_res', res);
    });

    socket.on('get_h', (target) => {
        const id = [socket.un, target].sort().join('_');
        const prof = db.profiles[target] || { nick: target, ls: "Offline" };
        if (sessions[target]) prof.ls = "Online";
        socket.emit('h_res', { target, msgs: db.messages[id] || [], prof });
    });

    socket.on('msg', async (d) => {
        if (!socket.un || !d.to || !d.txt.trim()) return;
        const msg = { f: socket.un, t: d.to, txt: d.txt, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
        const id = [socket.un, d.to].sort().join('_');
        if (!db.messages[id]) db.messages[id] = [];
        db.messages[id].push(msg);
        await saveDB();
        if (sessions[d.to]) io.to(sessions[d.to]).emit('receive', { room: socket.un, msg, senderProf: db.profiles[socket.un] });
        socket.emit('receive', { room: d.to, msg, senderProf: db.profiles[d.to] });
    });

    socket.on('disconnect', () => {
        if (socket.un) {
            db.profiles[socket.un].ls = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            delete sessions[socket.un];
        }
    });
});

http.listen(3000, '0.0.0.0');
