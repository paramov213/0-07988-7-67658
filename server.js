const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 1e7 }); // 10MB для фото
const fs = require('fs');

const DB_FILE = './users.json';
const MSG_FILE = './messages.json';

let db = { users: {} };
let history = [];

if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE));
if (fs.existsSync(MSG_FILE)) history = JSON.parse(fs.readFileSync(MSG_FILE));

const saveData = () => {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
    fs.writeFileSync(MSG_FILE, JSON.stringify(history, null, 2));
};

app.use(express.static(__dirname));

io.on('connection', (socket) => {
    socket.on('auth', (data) => {
        if (!data.login || !data.password) return socket.emit('auth-error', 'Заполните данные');
        const login = data.login.trim().toLowerCase();
        
        if (data.type === 'register') {
            if (db.users[login]) return socket.emit('auth-error', 'Логин занят');
            db.users[login] = { 
                password: data.password, 
                displayName: data.login, 
                avatar: "", 
                bio: "Рад быть здесь!", 
                banner: "linear-gradient(45deg, #6e8efb, #a777e3)" 
            };
            saveData();
        } else {
            if (!db.users[login] || db.users[login].password !== data.password) return socket.emit('auth-error', 'Неверный вход');
        }
        
        socket.userName = login;
        const userHistory = history.filter(m => m.from === login || m.to === login);
        socket.emit('auth-success', { user: login, profile: db.users[login], history: userHistory });
    });

    socket.on('search-user', (query) => {
        const q = query.replace('@', '').toLowerCase().trim();
        const found = Object.keys(db.users).find(u => u === q || u.includes(q));
        if (found) socket.emit('search-result', { exists: true, username: found });
        else socket.emit('search-result', { exists: false });
    });

    socket.on('private-message', (data) => {
        if (!socket.userName || !data.to) return;
        const msg = {
            from: socket.userName,
            to: data.to,
            text: data.text,
            image: data.image,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            ts: Date.now()
        };
        history.push(msg);
        if (history.length > 1000) history.shift();
        saveData();
        io.emit('msg-receive', msg);
    });

    socket.on('update-profile', (data) => {
        if (db.users[socket.userName]) {
            Object.assign(db.users[socket.userName], data);
            saveData();
            socket.emit('profile-updated', db.users[socket.userName]);
        }
    });

    socket.on('get-user-profile', (target) => {
        const u = db.users[target.toLowerCase()];
        if (u) socket.emit('user-profile-data', { ...u, username: target });
    });
});

http.listen(3000, '0.0.0.0', () => console.log('celestra is glowing on :3000'));
