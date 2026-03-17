const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, { maxHttpBufferSize: 5e6 });
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
        if (!data.login || !data.password || data.login.trim() === "") {
            return socket.emit('auth-error', 'Введите логин и пароль!');
        }
        
        const login = data.login.trim().toLowerCase();
        if (data.type === 'register') {
            if (db.users[login]) return socket.emit('auth-error', 'Пользователь уже существует');
            db.users[login] = { password: data.password, displayName: data.login, avatar: "", bio: "" };
            saveData();
        } else {
            if (!db.users[login] || db.users[login].password !== data.password) {
                return socket.emit('auth-error', 'Неверные данные');
            }
        }
        socket.userName = login;
        const userHistory = history.filter(m => m.from === login || m.to === login);
        socket.emit('auth-success', { user: login, profile: db.users[login], history: userHistory });
    });

    socket.on('search-user', (query) => {
        const target = query.replace('@', '').toLowerCase().trim();
        const found = Object.keys(db.users).find(u => u === target);
        if (found) {
            socket.emit('search-result', { exists: true, username: found, avatar: db.users[found].avatar });
        } else {
            socket.emit('search-result', { exists: false });
        }
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
        if (history.length > 500) history.shift();
        saveData();
        io.emit('msg-receive', msg); // Упрощенная рассылка для стабильности
    });

    socket.on('update-profile', (data) => {
        if (db.users[socket.userName]) {
            Object.assign(db.users[socket.userName], data);
            saveData();
            socket.emit('profile-updated', db.users[socket.userName]);
        }
    });
});

http.listen(3000, '0.0.0.0', () => console.log('Celestra Color Edition: http://localhost:3000'));
